(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function fmt2(n) { return (Number(n) || 0).toFixed(2); }
  function fmtDate(d) {
    if (!d) return "";
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  function toast(kind, title, msg) { if (E.toast) E.toast(kind, title, msg); }
  function warn() { if (E.warn) E.warn.apply(E, arguments); }

  var state = {
    entries: [],
    grouped: [],
    sort: { key: "created_at", dir: "desc" },
    resolutionFilter: "unresolved",
    expandedOrderId: null,
    _mount: null,
    _autoInterval: null
  };

  // ─── API ────────────────────────────────────────────────────────────────
  function apiFeedbackList() {
    return E.apiFetch("/supplier-orders/feedback", { method: "GET" });
  }
  function apiOrderDetail(id) {
    return E.apiFetch("/supplier-orders/" + id, { method: "GET" });
  }
  function apiResolveFeedback(feedbackId, resolution_status, supplier_notes) {
    return E.apiFetch("/supplier-orders/feedback/" + feedbackId + "/resolve", {
      method: "PUT", body: JSON.stringify({ resolution_status: resolution_status, supplier_notes: supplier_notes })
    });
  }

  var RESOLUTION_OPTIONS = ["Acknowledged", "Replacement Sent", "Credit Issued", "Disputed", "Resolved"];

  // ─── Grouping ──────────────────────────────────────────────────────────
  function groupByOrder(entries) {
    var map = {};
    entries.forEach(function (fb) {
      var key = fb.order_id;
      if (!map[key]) {
        map[key] = {
          order_id: fb.order_id,
          pharmacy_name: fb.pharmacy_name,
          supplier_name: fb.supplier_name,
          order_created_at: fb.order_created_at,
          order_status: fb.order_status || "",
          latest_feedback_at: fb.created_at,
          feedbacks: []
        };
      }
      map[key].feedbacks.push(fb);
      if (fb.created_at > map[key].latest_feedback_at) map[key].latest_feedback_at = fb.created_at;
    });
    return Object.values(map);
  }

  function applySort() {
    var sk = state.sort.key;
    var sd = state.sort.dir === "asc" ? 1 : -1;
    state.grouped.sort(function (a, b) {
      var va = a[sk] || "", vb = b[sk] || "";
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      return va < vb ? -sd : va > vb ? sd : 0;
    });
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  function renderAll(mount) {
    var content = mount.querySelector("#sof-content");
    if (!content) return;

    // Filter dropdown
    var rf = state.resolutionFilter;
    var filterHtml = "<div style='margin-bottom:8px;'>" +
      "<select id='sof-resolution-filter' class='eikon-input' style='width:160px;font-size:12px;'>" +
        "<option value='unresolved'" + (rf === "unresolved" ? " selected" : "") + ">Unresolved</option>" +
        "<option value='resolved'" + (rf === "resolved" ? " selected" : "") + ">Resolved</option>" +
        "<option value=''" + (rf === "" ? " selected" : "") + ">All</option>" +
      "</select></div>";

    // Apply resolution filter
    var displayed = state.grouped;
    if (rf === "unresolved") {
      displayed = state.grouped.filter(function (grp) {
        return grp.feedbacks.some(function (fb) { return !fb.resolution_status; });
      });
    } else if (rf === "resolved") {
      displayed = state.grouped.filter(function (grp) {
        return grp.feedbacks.every(function (fb) { return !!fb.resolution_status; });
      });
    }

    if (!state.grouped.length) {
      content.innerHTML = "<div style='text-align:center;padding:40px;'>" +
        "<div style='font-size:36px;margin-bottom:12px;'>\u2705</div>" +
        "<div style='font-weight:700;'>No feedback received</div>" +
        "<div style='color:var(--muted);margin-top:4px;'>Problem reports from pharmacies will appear here.</div>" +
      "</div>";
      return;
    }

    if (!displayed.length) {
      var emptyMsg = rf === "unresolved"
        ? "<div style='font-size:36px;margin-bottom:12px;'>\u2705</div><div style='font-weight:700;'>No unresolved feedbacks</div><div style='color:var(--muted);margin-top:4px;'>All feedback has been addressed.</div>"
        : "<div style='font-size:36px;margin-bottom:12px;'>\uD83D\uDCCB</div><div style='font-weight:700;'>No resolved feedbacks yet</div><div style='color:var(--muted);margin-top:4px;'>Resolved items will appear here.</div>";
      content.innerHTML = filterHtml + "<div style='text-align:center;padding:40px;'>" + emptyMsg + "</div>";
      wireEvents(mount);
      return;
    }

    var sk = state.sort.key;
    var sd = state.sort.dir;

    var cols = [
      { key: "order_id", label: "Order #" },
      { key: "pharmacy_name", label: "Pharmacy" },
      { key: "order_created_at", label: "Order Date" },
      { key: "latest_feedback_at", label: "Reported" },
      { key: "feedbacks", label: "Problems" }
    ];

    var html = filterHtml + "<div style='overflow-x:auto;'><table class='sof-table'><thead><tr>";
    cols.forEach(function (col) {
      var active = sk === col.key;
      var arrow = active ? (sd === "asc" ? " \u25B2" : " \u25BC") : "";
      var sortable = col.key !== "feedbacks";
      html += "<th" + (sortable ? " data-sof-sort='" + col.key + "' style='cursor:pointer;'" : "") + ">" + esc(col.label) + arrow + "</th>";
    });
    html += "<th>Actions</th></tr></thead><tbody>";

    displayed.forEach(function (grp) {
      var isExpanded = state.expandedOrderId === grp.order_id;
      html += "<tr class='" + (isExpanded ? "sof-expanded" : "") + "'>" +
        "<td>#" + grp.order_id + "</td>" +
        "<td>" + esc(grp.pharmacy_name) + "</td>" +
        "<td>" + fmtDate(grp.order_created_at) + "</td>" +
        "<td>" + fmtDate(grp.latest_feedback_at) + "</td>" +
        "<td><span style='color:#ff5a7a;font-weight:700;'>" + grp.feedbacks.length + " issue" + (grp.feedbacks.length !== 1 ? "s" : "") + "</span></td>" +
        "<td><button class='eikon-btn' data-sof-expand='" + grp.order_id + "' style='font-size:11px;padding:3px 10px;'>" + (isExpanded ? "Collapse" : "View") + "</button></td>" +
      "</tr>";

      if (isExpanded) {
        html += "<tr><td colspan='6'>" + renderFeedbackDetail(grp) + "</td></tr>";
      }
    });

    html += "</tbody></table></div>";
    content.innerHTML = html;
    wireEvents(mount);
  }

  function renderFeedbackDetail(grp) {
    var html = "<div style='padding:14px;background:rgba(255,255,255,.02);border-radius:8px;'>" +
      "<div style='font-weight:700;margin-bottom:4px;'>Pharmacy: " + esc(grp.pharmacy_name) + "</div>" +
      "<div style='font-size:12px;color:var(--muted);margin-bottom:10px;'>Order placed: " + fmtDate(grp.order_created_at) + "</div>" +
      "<table style='width:100%;border-collapse:collapse;font-size:12px;'><thead><tr>" +
      "<th style='text-align:left;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Description</th>" +
      "<th style='text-align:left;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Barcode</th>" +
      "<th style='text-align:left;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Qty</th>" +
      "<th style='text-align:left;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Batch</th>" +
      "<th style='text-align:left;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Expiry</th>" +
      "<th style='text-align:left;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Problem</th>" +
      "<th style='text-align:left;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Notes</th>" +
      "<th style='text-align:left;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Reported</th>" +
      "<th style='text-align:left;padding:6px;font-size:11px;color:rgba(233,238,247,.6);'>Resolution</th>" +
      "</tr></thead><tbody>";

    grp.feedbacks.forEach(function (fb) {
      var problemColors = {
        "Not Received": "#ff5a7a",
        "Wrong Pick": "#e8c840",
        "Damaged": "#ff5a7a",
        "Short Quantity": "#ffaf32",
        "Other": "#5aa2ff"
      };
      var pColor = problemColors[fb.problem_type] || "#ff5a7a";

      var resCell = "";
      if (fb.resolution_status) {
        var rColors = { "Acknowledged": "#5aa2ff", "Replacement Sent": "#43d17a", "Credit Issued": "#43d17a", "Disputed": "#ffaf32", "Resolved": "#43d17a" };
        var rc = rColors[fb.resolution_status] || "#5aa2ff";
        resCell = "<span style='display:inline-block;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:700;" +
          "background:" + rc + "22;color:" + rc + ";'>" + esc(fb.resolution_status) + "</span>";
        if (fb.supplier_notes) resCell += "<div style='font-size:10px;color:var(--muted);margin-top:2px;'>" + esc(fb.supplier_notes) + "</div>";
      } else {
        resCell = "<div style='display:flex;flex-direction:column;gap:4px;min-width:180px;'>" +
          "<select class='eikon-input sof-resolve-select' data-resolve-id='" + fb.id + "' style='font-size:11px;padding:2px 4px;'>" +
            "<option value=''>-- Respond --</option>";
        RESOLUTION_OPTIONS.forEach(function (opt) {
          resCell += "<option value='" + esc(opt) + "'>" + esc(opt) + "</option>";
        });
        resCell += "</select>" +
          "<input type='text' class='eikon-input sof-resolve-notes' data-resolve-notes-id='" + fb.id + "' " +
            "placeholder='Note (optional)' style='font-size:11px;padding:2px 4px;'>" +
          "<button class='eikon-btn sof-resolve-btn' data-resolve-btn-id='" + fb.id + "' " +
            "style='font-size:10px;padding:2px 8px;'>Submit</button>" +
        "</div>";
      }

      html += "<tr style='background:rgba(255,90,122,.06);'>" +
        "<td style='padding:6px;font-weight:600;'>" + esc(fb.item_description) + "</td>" +
        "<td style='padding:6px;'>" + esc(fb.item_barcode) + "</td>" +
        "<td style='padding:6px;'>" + esc(fb.item_qty) + "</td>" +
        "<td style='padding:6px;'>" + esc(fb.item_batch) + "</td>" +
        "<td style='padding:6px;'>" + esc(fb.item_expiry_date) + "</td>" +
        "<td style='padding:6px;'><span style='display:inline-block;padding:2px 8px;border-radius:5px;font-size:11px;font-weight:700;" +
          "background:" + pColor + "22;color:" + pColor + ";'>" + esc(fb.problem_type) + "</span></td>" +
        "<td style='padding:6px;font-size:11px;color:var(--muted);'>" + esc(fb.notes) + "</td>" +
        "<td style='padding:6px;font-size:11px;'>" + fmtDate(fb.created_at) + "</td>" +
        "<td style='padding:6px;'>" + resCell + "</td>" +
      "</tr>";
    });

    html += "</tbody></table></div>";
    return html;
  }

  // ─── Events ─────────────────────────────────────────────────────────────
  function wireEvents(mount) {
    // Resolution filter
    var filterEl = mount.querySelector("#sof-resolution-filter");
    if (filterEl) {
      filterEl.addEventListener("change", function () {
        state.resolutionFilter = filterEl.value;
        renderAll(mount);
      });
    }

    // Sort
    mount.querySelectorAll("[data-sof-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sof-sort");
        if (state.sort.key === key) {
          state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        } else {
          state.sort.key = key;
          state.sort.dir = "desc";
        }
        applySort();
        renderAll(mount);
      });
    });

    // Expand
    mount.querySelectorAll("[data-sof-expand]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var orderId = Number(btn.getAttribute("data-sof-expand"));
        state.expandedOrderId = state.expandedOrderId === orderId ? null : orderId;
        renderAll(mount);
      });
    });

    // Resolve feedback
    mount.querySelectorAll(".sof-resolve-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var fbId = Number(btn.getAttribute("data-resolve-btn-id"));
        var selectEl = mount.querySelector(".sof-resolve-select[data-resolve-id='" + fbId + "']");
        var notesEl = mount.querySelector(".sof-resolve-notes[data-resolve-notes-id='" + fbId + "']");
        var resolution = selectEl ? selectEl.value : "";
        var notes = notesEl ? notesEl.value.trim() : "";
        if (!resolution) { toast("bad", "Required", "Please select a resolution"); return; }
        btn.disabled = true;
        btn.textContent = "Saving\u2026";
        apiResolveFeedback(fbId, resolution, notes)
          .then(function () {
            toast("good", "Resolved", "Feedback resolved as: " + resolution);
            return refreshData(mount);
          })
          .catch(function (err) {
            toast("bad", "Error", err.message || "Failed to resolve");
            btn.disabled = false;
            btn.textContent = "Submit";
          });
      });
    });
  }

  // ─── Data ───────────────────────────────────────────────────────────────
  async function refreshData(mount) {
    try {
      var resp = await apiFeedbackList();
      state.entries = resp.entries || [];
      state.grouped = groupByOrder(state.entries);
      applySort();
      renderAll(mount);
    } catch (err) {
      warn("Failed to load feedback", err);
      toast("bad", "Error", "Failed to load order feedback");
    }
  }

  // ─── CSS ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("sof-styles")) return;
    var style = document.createElement("style");
    style.id = "sof-styles";
    style.textContent = [
      ".sof-table { width:100%; border-collapse:collapse; font-size:13px; }",
      ".sof-table th { padding:8px; text-align:left; font-size:11px; font-weight:600; color:rgba(233,238,247,.45); text-transform:uppercase; letter-spacing:.03em; border-bottom:1px solid rgba(255,255,255,.08); }",
      ".sof-table td { padding:8px; border-bottom:1px solid rgba(255,255,255,.05); }",
      ".sof-table tr:hover { background:rgba(90,162,255,.06); }",
      ".sof-expanded { background:rgba(90,162,255,.04)!important; }"
    ].join("\n");
    document.head.appendChild(style);
  }

  // ─── Module ─────────────────────────────────────────────────────────────
  E.registerModule({
    id: "supplier-order-feedback",
    title: "Order Feedback",
    icon: "\u26A0\uFE0F",
    order: 25,
    section: "supplier",
    render: async function (ctx) {
      injectStyles();
      state._mount = ctx.mount;
      state.expandedOrderId = null;

      ctx.mount.innerHTML =
        '<div class="eikon-card" style="max-width:1300px;margin:0 auto;">' +
        '  <div style="font-weight:900;font-size:18px;margin-bottom:16px;">Order Feedback</div>' +
        '  <div style="color:var(--muted);font-size:13px;margin-bottom:16px;">Problem reports from pharmacies on received orders.</div>' +
        '  <div id="sof-content"></div>' +
        '</div>';

      await refreshData(ctx.mount);

      // 30s auto-update
      if (state._autoInterval) clearInterval(state._autoInterval);
      state._autoInterval = setInterval(function () {
        if (E.state.activeModuleId !== "supplier-order-feedback") return;
        // Don't refresh while supplier is resolving feedback in an expanded order
        if (state.expandedOrderId) return;
        apiFeedbackList().then(function (resp) {
          if (E.state.activeModuleId !== "supplier-order-feedback") return;
          state.entries = resp.entries || [];
          state.grouped = groupByOrder(state.entries);
          applySort();
          renderAll(ctx.mount);
        }).catch(function () {});
      }, 30000);

      var onHashChange = function () {
        if (E.state.activeModuleId !== "supplier-order-feedback" || E.getHashModuleId() !== "supplier-order-feedback") {
          clearInterval(state._autoInterval);
          state._autoInterval = null;
          window.removeEventListener("hashchange", onHashChange);
        }
      };
      window.addEventListener("hashchange", onHashChange);
    }
  });
})();
