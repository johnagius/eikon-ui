(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ------------------------------------------------------------
  // Logging helpers
  // ------------------------------------------------------------
  function log() { E.log.apply(E, ["[nearexpiry]"].concat([].slice.call(arguments))); }
  function dbg() { E.dbg.apply(E, ["[nearexpiry]"].concat([].slice.call(arguments))); }
  function err() { E.err.apply(E, ["[nearexpiry]"].concat([].slice.call(arguments))); }

  // ------------------------------------------------------------
  // API helper (consistent with other modules)
  // ------------------------------------------------------------
  var reqSeq = 0;

  async function apiFetchDbg(path, options, tag) {
    reqSeq++;
    var reqId = "NE#" + String(reqSeq) + "-" + String(Date.now());
    var method = (options && options.method) ? String(options.method).toUpperCase() : "GET";
    var t0 = Date.now();

    dbg(reqId + " -> " + method + " " + path + (tag ? (" [" + tag + "]") : ""));
    try {
      var out = await E.apiFetch(path, options || {});
      dbg(reqId + " <- OK " + out.status + " (" + (Date.now() - t0) + "ms)");
      return out;
    } catch (e) {
      err(reqId + " <- ERR (" + (Date.now() - t0) + "ms)", e);
      throw e;
    }
  }

  async function apiJson(path, options, tag) {
    var res = await apiFetchDbg(path, options, tag);
    var j = null;
    try { j = await res.json(); } catch (e) { j = null; }
    if (!res.ok || !j || j.ok === false) {
      var msg = (j && (j.error || j.message)) ? (j.error || j.message) : ("HTTP " + res.status);
      throw new Error(msg);
    }
    return j;
  }

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  function esc(s) { return E.esc ? E.esc(s) : String(s || "").replace(/[&<>"']/g, function (c) { return ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" })[c]; }); }

  function ymdToDmyDash(ymd) {
    var s = String(ymd || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var p = s.split("-");
    return p[2] + "-" + p[1] + "-" + p[0];
  }

  function todayLocalYmd() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var da = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + da;
  }

  function daysUntil(ymd) {
    var s = String(ymd || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

    // Compare local midnights to keep it intuitive for staff (calendar dates)
    var parts = s.split("-");
    var y = Number(parts[0]), m = Number(parts[1]) - 1, d = Number(parts[2]);
    var exp = new Date(y, m, d);
    exp.setHours(0, 0, 0, 0);

    var now = new Date();
    now.setHours(0, 0, 0, 0);

    var diffMs = exp.getTime() - now.getTime();
    return Math.round(diffMs / 86400000);
  }

  function normalize(s) { return String(s || "").toLowerCase().trim(); }

  function computeDerived(e) {
    var d = daysUntil(e.expiry_date);
    e.days_to_expire = (typeof d === "number") ? d : null;
    return e;
  }

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  var state = {
    entries: [],
    filtered: [],
    q: "",
    sort: { key: "expiry_date", dir: "asc" },
    lastLoadedAt: 0
  };

  // ------------------------------------------------------------
  // Sort / filter
  // ------------------------------------------------------------
  function applyFilterSort() {
    var q = normalize(state.q);
    var list = (Array.isArray(state.entries) ? state.entries.slice() : []);

    if (q) {
      list = list.filter(function (e) {
        var hay = [
          e.product_name,
          e.expiry_date,
          e.location,
          e.notes
        ].map(normalize).join(" | ");
        return hay.indexOf(q) !== -1;
      });
    }

    var key = state.sort.key || "expiry_date";
    var dir = state.sort.dir === "desc" ? -1 : 1;

    list.sort(function (a, b) {
      if (key === "days_to_expire") {
        var da = (typeof a.days_to_expire === "number") ? a.days_to_expire : 999999;
        var db = (typeof b.days_to_expire === "number") ? b.days_to_expire : 999999;
        if (da !== db) return (da < db ? -1 : 1) * dir;
        var ea = String(a.expiry_date || "");
        var eb = String(b.expiry_date || "");
        if (ea !== eb) return (ea < eb ? -1 : 1) * dir;
        var na = normalize(a.product_name);
        var nb = normalize(b.product_name);
        if (na !== nb) return (na < nb ? -1 : 1) * dir;
        return (a.id || 0) - (b.id || 0);
      }

      if (key === "expiry_date") {
        var sa = String(a.expiry_date || "");
        var sb = String(b.expiry_date || "");
        if (sa !== sb) return (sa < sb ? -1 : 1) * dir;
        var na2 = normalize(a.product_name);
        var nb2 = normalize(b.product_name);
        if (na2 !== nb2) return (na2 < nb2 ? -1 : 1) * dir;
        return (a.id || 0) - (b.id || 0);
      }

      var va = normalize(a[key]);
      var vb = normalize(b[key]);
      if (va !== vb) return (va < vb ? -1 : 1) * dir;

      // stable-ish fallback
      var eda = String(a.expiry_date || "");
      var edb = String(b.expiry_date || "");
      if (eda !== edb) return (eda < edb ? -1 : 1) * dir;
      return (a.id || 0) - (b.id || 0);
    });

    state.filtered = list;
  }

  function setSortIndicators(tableEl) {
    var ths = E.qa("th[data-key]", tableEl);
    ths.forEach(function (th) {
      var key = th.getAttribute("data-key") || "";
      var wrap = th.querySelector(".ne-sort");
      if (!wrap) return;
      var car = wrap.querySelector(".car");
      if (!car) return;

      if (key && state.sort.key === key && key !== "actions") {
        wrap.classList.add("on");
        car.textContent = state.sort.dir === "desc" ? "▼" : "▲";
      } else {
        wrap.classList.remove("on");
        car.textContent = "";
      }
    });
  }

  function wireSortableHeaders(tableEl) {
    var ths = E.qa("th[data-key]", tableEl);
    ths.forEach(function (th) {
      var key = th.getAttribute("data-key");
      if (!key || key === "actions") return;
      th.addEventListener("click", function () {
        if (state.sort.key === key) state.sort.dir = (state.sort.dir === "asc" ? "desc" : "asc");
        else { state.sort.key = key; state.sort.dir = "asc"; }
        applyFilterSort();
        renderTable();
      });
    });
    setSortIndicators(tableEl);
  }

  // ------------------------------------------------------------
  // Render table
  // ------------------------------------------------------------
  function daysPillHtml(d) {
    if (typeof d !== "number") return '<span class="ne-pill ne-pill-unknown">—</span>';
    if (d < 0) return '<span class="ne-pill ne-pill-expired">Expired (' + String(Math.abs(d)) + 'd)</span>';
    if (d === 0) return '<span class="ne-pill ne-pill-expired">Expires today</span>';
    if (d <= 30) return '<span class="ne-pill ne-pill-soon">' + String(d) + ' days</span>';
    if (d <= 90) return '<span class="ne-pill ne-pill-warn">' + String(d) + ' days</span>';
    return '<span class="ne-pill ne-pill-ok">' + String(d) + ' days</span>';
  }

  function rowClass(d) {
    if (typeof d !== "number") return "";
    if (d < 0) return "ne-row-expired";
    if (d <= 30) return "ne-row-soon";
    if (d <= 90) return "ne-row-warn";
    return "";
  }

  function renderTable() {
    var tbody = E.q("#ne-tbody");
    var table = E.q("#ne-table");
    if (!tbody || !table) return;

    applyFilterSort();
    setSortIndicators(table);

    var list = state.filtered || [];
    var html = "";

    if (!list.length) {
      html = '<tr><td colspan="6" style="color:var(--muted);padding:16px;">No items found.</td></tr>';
      tbody.innerHTML = html;
      updateCount();
      return;
    }

    list.forEach(function (e) {
      var d = (typeof e.days_to_expire === "number") ? e.days_to_expire : daysUntil(e.expiry_date);
      var cls = rowClass(d);
      html += '<tr class="' + cls + '">' +
        '<td><div class="ne-name">' + esc(e.product_name || "") + '</div></td>' +
        '<td><div class="ne-date">' + esc(ymdToDmyDash(e.expiry_date || "")) + '</div></td>' +
        '<td>' + daysPillHtml(d) + '</td>' +
        '<td><div class="ne-muted">' + esc(e.location || "") + '</div></td>' +
        '<td><div class="ne-muted">' + esc(e.notes || "") + '</div></td>' +
        '<td class="ne-actions">' +
          '<button class="eikon-btn" data-act="edit" data-id="' + String(e.id) + '">Edit</button>' +
          '<button class="eikon-btn danger" data-act="del" data-id="' + String(e.id) + '">Delete</button>' +
        '</td>' +
      '</tr>';
    });

    tbody.innerHTML = html;
    updateCount();
  }

  function updateCount() {
    var el = E.q("#ne-count");
    if (!el) return;
    var n = (state.filtered || []).length;
    el.textContent = String(n) + (n === 1 ? " item" : " items");
  }

  // ------------------------------------------------------------
  // CRUD actions
  // ------------------------------------------------------------
  async function loadEntries() {
    E.showToast && E.showToast("Loading…");
    var j = await apiJson("/near-expiry/entries", { method: "GET" }, "list");
    var rows = (j && j.entries) ? j.entries : [];
    state.entries = rows.map(function (e) { return computeDerived(e); });
    state.lastLoadedAt = Date.now();
    applyFilterSort();
    renderTable();
  }

  function getFormValues(prefix) {
    var nameEl = E.q("#" + prefix + "-name");
    var expEl = E.q("#" + prefix + "-exp");
    var locEl = E.q("#" + prefix + "-loc");
    var notesEl = E.q("#" + prefix + "-notes");

    return {
      product_name: nameEl ? String(nameEl.value || "").trim() : "",
      expiry_date: expEl ? String(expEl.value || "").trim() : "",
      location: locEl ? String(locEl.value || "").trim() : "",
      notes: notesEl ? String(notesEl.value || "").trim() : ""
    };
  }

  function validatePayload(p) {
    if (!p.product_name) return "Product name is required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.expiry_date || "")) return "Expiry date is required.";
    return "";
  }

  async function createEntryFromForm() {
    var payload = getFormValues("ne");
    var v = validatePayload(payload);
    if (v) {
      E.modal.show("Near Expiry", '<div style="color:var(--danger);font-weight:800;">' + esc(v) + "</div>", [
        { label: "OK", primary: true, onClick: function () { E.modal.hide(); } }
      ]);
      return;
    }

    var j = await apiJson("/near-expiry/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }, "create");

    if (j && j.entry) {
      state.entries.unshift(computeDerived(j.entry));
      applyFilterSort();
      renderTable();
    } else {
      await loadEntries();
    }

    // clear form
    var nameEl = E.q("#ne-name");
    var expEl = E.q("#ne-exp");
    var locEl = E.q("#ne-loc");
    var notesEl = E.q("#ne-notes");
    if (nameEl) nameEl.value = "";
    if (expEl) expEl.value = "";
    if (locEl) locEl.value = "";
    if (notesEl) notesEl.value = "";

    E.showToast && E.showToast("Saved");
  }

  function findById(id) {
    id = Number(id || 0);
    for (var i = 0; i < state.entries.length; i++) {
      if (Number(state.entries[i].id) === id) return state.entries[i];
    }
    return null;
  }

  function showEditModal(entry) {
    var e = entry;
    var html =
      '<div class="eikon-row" style="gap:10px;align-items:flex-end;">' +
        '<div class="eikon-field" style="flex:1;min-width:240px;">' +
          '<div class="eikon-label">Product name</div>' +
          '<input id="ne-edit-name" class="eikon-input" value="' + esc(e.product_name || "") + '" />' +
        '</div>' +
        '<div class="eikon-field">' +
          '<div class="eikon-label">Expiry date</div>' +
          '<input id="ne-edit-exp" class="eikon-input" type="date" value="' + esc(e.expiry_date || "") + '" />' +
        '</div>' +
        '<div class="eikon-field" style="min-width:200px;">' +
          '<div class="eikon-label">Location (optional)</div>' +
          '<input id="ne-edit-loc" class="eikon-input" value="' + esc(e.location || "") + '" />' +
        '</div>' +
        '<div class="eikon-field" style="flex:1;min-width:260px;">' +
          '<div class="eikon-label">Notes (optional)</div>' +
          '<input id="ne-edit-notes" class="eikon-input" value="' + esc(e.notes || "") + '" />' +
        '</div>' +
      '</div>' +
      '<div class="eikon-help" style="margin-top:10px;color:var(--muted);">Days to expire: <b>' + esc(String(daysUntil(e.expiry_date))) + '</b></div>';

    E.modal.show("Edit Near Expiry", html, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Save",
        primary: true,
        onClick: function () {
          (async function () {
            try {
              var payload = {
                product_name: String((E.q("#ne-edit-name") || {}).value || "").trim(),
                expiry_date: String((E.q("#ne-edit-exp") || {}).value || "").trim(),
                location: String((E.q("#ne-edit-loc") || {}).value || "").trim(),
                notes: String((E.q("#ne-edit-notes") || {}).value || "").trim()
              };
              var v = validatePayload(payload);
              if (v) throw new Error(v);

              var j = await apiJson("/near-expiry/entries/" + String(e.id), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
              }, "update");

              if (j && j.entry) {
                // update in state
                for (var i = 0; i < state.entries.length; i++) {
                  if (Number(state.entries[i].id) === Number(e.id)) {
                    state.entries[i] = computeDerived(j.entry);
                    break;
                  }
                }
                applyFilterSort();
                renderTable();
              } else {
                await loadEntries();
              }

              E.modal.hide();
              E.showToast && E.showToast("Updated");
            } catch (ex) {
              E.modal.show("Update failed", '<div style="color:var(--danger);font-weight:800;">' + esc(ex && (ex.message || ex)) + "</div>", [
                { label: "OK", primary: true, onClick: function () { E.modal.hide(); } }
              ]);
            }
          })();
        }
      }
    ]);
  }

  function confirmDelete(entry) {
    var e = entry;
    E.modal.show(
      "Delete item",
      "<div style='margin-bottom:8px;'>Delete <b>" + esc(e.product_name || "") + "</b> (Expiry: <b>" + esc(ymdToDmyDash(e.expiry_date || "")) + "</b>)?</div>" +
      "<div style='color:var(--muted);font-size:12px;'>This cannot be undone.</div>",
      [
        { label: "Cancel", onClick: function () { E.modal.hide(); } },
        {
          label: "Delete",
          danger: true,
          onClick: function () {
            (async function () {
              try {
                await apiJson("/near-expiry/entries/" + String(e.id), { method: "DELETE" }, "delete");
                state.entries = state.entries.filter(function (x) { return Number(x.id) !== Number(e.id); });
                applyFilterSort();
                renderTable();
                E.modal.hide();
                E.showToast && E.showToast("Deleted");
              } catch (ex) {
                E.modal.show("Delete failed", '<div style="color:var(--danger);font-weight:800;">' + esc(ex && (ex.message || ex)) + "</div>", [
                  { label: "OK", primary: true, onClick: function () { E.modal.hide(); } }
                ]);
              }
            })();
          }
        }
      ]
    );
  }

  // ------------------------------------------------------------
  // Print
  // ------------------------------------------------------------
  function openPrintWindow(entries, queryText) {
    var list = Array.isArray(entries) ? entries.slice() : [];
    var q = String(queryText || "").trim();
    var today = todayLocalYmd();

    // Ensure derived
    list = list.map(function (e) { return computeDerived(Object.assign({}, e)); });

    // Sort info (current view)
    var k = state.sort.key || "expiry_date";
    var ddir = state.sort.dir || "asc";

    var w = window.open("", "_blank");
    if (!w) {
      E.modal.show("Print", "<div style='white-space:pre-wrap;color:var(--muted)'>Popup blocked. Please allow popups for printing.</div>", [
        { label: "OK", primary: true, onClick: function () { E.modal.hide(); } }
      ]);
      return;
    }

    var rowsHtml = list.map(function (e) {
      var d = (typeof e.days_to_expire === "number") ? e.days_to_expire : daysUntil(e.expiry_date);
      var dTxt = (typeof d === "number") ? (d < 0 ? ("Expired (" + Math.abs(d) + "d)") : String(d)) : "";
      return "<tr>" +
        "<td>" + esc(e.product_name || "") + "</td>" +
        "<td>" + esc(ymdToDmyDash(e.expiry_date || "")) + "</td>" +
        "<td style='text-align:right;'>" + esc(dTxt) + "</td>" +
        "<td>" + esc(e.location || "") + "</td>" +
        "<td>" + esc(e.notes || "") + "</td>" +
      "</tr>";
    }).join("");

    var sub = [];
    sub.push("As of " + ymdToDmyDash(today));
    if (q) sub.push("Filter: " + q);
    sub.push("Sort: " + k + " " + ddir);

    var html =
      "<!doctype html><html><head><meta charset='utf-8' />" +
      "<meta name='viewport' content='width=device-width,initial-scale=1' />" +
      "<title>Near Expiry</title>" +
      "<style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:18px;color:#111;}" +
      "h1{margin:0 0 6px 0;font-size:18px;}" +
      ".sub{margin:0 0 14px 0;color:#444;font-size:12px;}" +
      "table{width:100%;border-collapse:collapse;font-size:12px;}" +
      "th,td{border-bottom:1px solid #ddd;padding:8px 6px;vertical-align:top;text-align:left;}" +
      "th{background:#f6f6f6;text-transform:uppercase;letter-spacing:.3px;font-size:11px;}" +
      "</style></head><body>" +
      "<h1>Near Expiry</h1>" +
      "<div class='sub'>" + esc(sub.join(" • ")) + "</div>" +
      "<table><thead><tr>" +
        "<th>Product</th><th>Expiry</th><th style='text-align:right;'>Days</th><th>Location</th><th>Notes</th>" +
      "</tr></thead><tbody>" +
      rowsHtml +
      "</tbody></table>" +
      "<script>" +
      "window.addEventListener('load', function(){setTimeout(function(){try{window.focus();}catch(e){} try{window.print();}catch(e){}}, 60);});" +
      "window.addEventListener('afterprint', function(){setTimeout(function(){try{window.close();}catch(e){}}, 250);});" +
      "</script>" +
      "</body></html>";

    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (e) {
      try { w.close(); } catch (e2) {}
      E.modal.show("Print failed", "<div style='white-space:pre-wrap;color:var(--danger)'>" + esc(e && (e.message || e)) + "</div>", [
        { label: "OK", primary: true, onClick: function () { E.modal.hide(); } }
      ]);
    }
  }

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  function render(container, ctx) {
    ctx = ctx || {};

    var html =
      '<style>' +
      '.ne-toolbar{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;}' +
      '.ne-toolbar-right{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-left:auto;}' +
      '.ne-sort{display:inline-flex;gap:8px;align-items:center;}' +
      '.ne-sort.on{color:var(--text);}' +
      'th[data-key]:not([data-key="actions"]){cursor:pointer;user-select:none;}' +
      'th[data-key]:not([data-key="actions"]):hover{color:var(--text);}' +
      '.ne-pill{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:999px;padding:6px 10px;background:rgba(255,255,255,.03);font-size:12px;font-weight:800;white-space:nowrap;}' +
      '.ne-pill-expired{border-color:rgba(255,90,122,.55);background:rgba(255,90,122,.12);}' +
      '.ne-pill-soon{border-color:rgba(255,180,90,.55);background:rgba(255,180,90,.12);}' +
      '.ne-pill-warn{border-color:rgba(255,220,90,.42);background:rgba(255,220,90,.10);}' +
      '.ne-pill-ok{border-color:rgba(67,209,122,.45);background:rgba(67,209,122,.10);}' +
      '.ne-pill-unknown{opacity:.7;}' +
      '.ne-row-expired{background:rgba(255,90,122,.08);}' +
      '.ne-row-soon{background:rgba(255,180,90,.06);}' +
      '.ne-row-warn{background:rgba(255,220,90,.05);}' +
      '.ne-actions{white-space:nowrap;display:flex;gap:8px;align-items:center;}' +
      '.ne-name{font-weight:900;}' +
      '.ne-date{font-weight:800;color:var(--text);}' +
      '.ne-muted{color:var(--muted);white-space:pre-wrap;}' +
      '</style>' +

      '<div class="eikon-content">' +

        '<div class="eikon-card">' +
          '<div class="eikon-row">' +
            '<div class="eikon-field" style="flex:1;min-width:240px;">' +
              '<div class="eikon-label">Product Name</div>' +
              '<input id="ne-name" class="eikon-input" placeholder="e.g. Paracetamol 500mg" />' +
            '</div>' +
            '<div class="eikon-field">' +
              '<div class="eikon-label">Expiry Date</div>' +
              '<input id="ne-exp" class="eikon-input" type="date" />' +
            '</div>' +
            '<div class="eikon-field" style="min-width:200px;">' +
              '<div class="eikon-label">Location (optional)</div>' +
              '<input id="ne-loc" class="eikon-input" placeholder="e.g. Shelf A3 / Fridge" />' +
            '</div>' +
            '<div class="eikon-field" style="flex:1;min-width:260px;">' +
              '<div class="eikon-label">Notes (optional)</div>' +
              '<input id="ne-notes" class="eikon-input" placeholder="e.g. return to supplier" />' +
            '</div>' +
            '<div class="eikon-field">' +
              '<div class="eikon-label">&nbsp;</div>' +
              '<button id="ne-add" class="eikon-btn primary">Add</button>' +
            '</div>' +
          '</div>' +
          '<div class="eikon-help" id="ne-help">Tip: You can sort the table by clicking the headers.</div>' +
        '</div>' +

        '<div class="eikon-card">' +
          '<div class="ne-toolbar">' +
            '<div class="eikon-field" style="flex:1;min-width:240px;">' +
              '<div class="eikon-label">Search</div>' +
              '<input id="ne-search" class="eikon-input" placeholder="Filter by product, expiry, location, notes…" />' +
            '</div>' +
            '<div class="ne-toolbar-right">' +
              '<span class="eikon-pill" id="ne-count">0 items</span>' +
              '<button id="ne-refresh" class="eikon-btn">Refresh</button>' +
              '<button id="ne-print" class="eikon-btn">Print</button>' +
            '</div>' +
          '</div>' +
          '<div style="height:10px"></div>' +
          '<div class="eikon-table-wrap">' +
            '<table class="eikon-table" id="ne-table">' +
              '<thead><tr>' +
                '<th data-key="product_name"><span class="ne-sort">Product <span class="car"></span></span></th>' +
                '<th data-key="expiry_date"><span class="ne-sort">Expiry <span class="car"></span></span></th>' +
                '<th data-key="days_to_expire"><span class="ne-sort">Days to expire <span class="car"></span></span></th>' +
                '<th data-key="location"><span class="ne-sort">Location <span class="car"></span></span></th>' +
                '<th data-key="notes"><span class="ne-sort">Notes <span class="car"></span></span></th>' +
                '<th data-key="actions">Actions</th>' +
              '</tr></thead>' +
              '<tbody id="ne-tbody"></tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +

      '</div>';

    container.innerHTML = html;

    // Wire events
    var addBtn = E.q("#ne-add");
    var refreshBtn = E.q("#ne-refresh");
    var printBtn = E.q("#ne-print");
    var searchEl = E.q("#ne-search");
    var tableEl = E.q("#ne-table");
    var tbody = E.q("#ne-tbody");

    if (addBtn) {
      addBtn.addEventListener("click", function () {
        (async function () {
          try { await createEntryFromForm(); }
          catch (ex) {
            E.modal.show("Save failed", '<div style="color:var(--danger);font-weight:800;">' + esc(ex && (ex.message || ex)) + "</div>", [
              { label: "OK", primary: true, onClick: function () { E.modal.hide(); } }
            ]);
          }
        })();
      });
    }

    // Enter key on form inputs saves
    ["ne-name", "ne-exp", "ne-loc", "ne-notes"].forEach(function (id) {
      var el = E.q("#" + id);
      if (!el) return;
      el.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          if (addBtn) addBtn.click();
        }
      });
    });

    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        (async function () {
          try { await loadEntries(); }
          catch (ex) {
            E.modal.show("Refresh failed", '<div style="color:var(--danger);font-weight:800;">' + esc(ex && (ex.message || ex)) + "</div>", [
              { label: "OK", primary: true, onClick: function () { E.modal.hide(); } }
            ]);
          }
        })();
      });
    }

    if (printBtn) {
      printBtn.addEventListener("click", function () {
        openPrintWindow(state.filtered || [], state.q || "");
      });
    }

    if (searchEl) {
      searchEl.addEventListener("input", function () {
        state.q = String(searchEl.value || "");
        applyFilterSort();
        renderTable();
      });
    }

    if (tableEl) wireSortableHeaders(tableEl);

    if (tbody) {
      tbody.addEventListener("click", function (ev) {
        var t = ev.target;
        if (!t) return;
        var act = t.getAttribute("data-act");
        var id = t.getAttribute("data-id");
        if (!act || !id) return;

        var entry = findById(id);
        if (!entry) return;

        if (act === "edit") showEditModal(entry);
        if (act === "del") confirmDelete(entry);
      });
    }

    // Initial load
    (async function () {
      try {
        await loadEntries();
        renderTable();
      } catch (ex) {
        E.modal.show("Near Expiry", '<div style="color:var(--danger);font-weight:800;">Failed to load: ' + esc(ex && (ex.message || ex)) + "</div>", [
          { label: "OK", primary: true, onClick: function () { E.modal.hide(); } }
        ]);
      }
    })();
  }

  // ------------------------------------------------------------
  // Register module
  // ------------------------------------------------------------
  E.registerModule({
    id: "nearexpiry",
    title: "Near Expiry",
    order: 14,
    icon: "⏳",
    render: render
  });

})();