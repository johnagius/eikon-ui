/* ui/modules.ddapoyc.js
   Eikon - DDA POYC module (UI)
   Government supplied DDAs register

   Endpoints (Cloudflare Worker):
   GET    /dda-poyc/entries?month=YYYY-MM&q=...
   POST   /dda-poyc/entries
   PUT    /dda-poyc/entries/:id
   DELETE /dda-poyc/entries/:id
   GET    /dda-poyc/report?from=YYYY-MM-DD&to=YYYY-MM-DD   (JSON)
   GET    /dda-poyc/report/html?from=YYYY-MM-DD&to=YYYY-MM-DD (Printable HTML)
*/
(function () {
  "use strict";

  const E = window.EIKON;

  // ---------- DOM helper (do NOT rely on E.el) ----------
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined) continue;
        if (k === "class") node.className = String(v);
        else if (k === "style") node.setAttribute("style", String(v));
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, String(v));
      }
    }
    for (const c of children) {
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(x => node.appendChild(x.nodeType ? x : document.createTextNode(String(x))));
      else node.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function pad2(n) { return String(n).padStart(2, "0"); }
  function todayYmd() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function thisMonth() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  function asIntPositive(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (!Number.isInteger(n)) return null;
    if (n < 1) return null;
    return n;
  }

  function apiFetchSmart(ctx, path, opts) {
    // Prefer runtime-provided API wrapper (adds Authorization).
    if (E && typeof E.apiFetch === "function") return E.apiFetch(path, opts || {});
    if (ctx && typeof ctx.apiFetch === "function") return ctx.apiFetch(path, opts || {});
    // Last resort: raw fetch (may fail auth if token not available here).
    const base = (E && E.apiBase) ? E.apiBase : "";
    return fetch(base.replace(/\/+$/, "") + path, {
      method: (opts && opts.method) || "GET",
      headers: Object.assign({ "Content-Type": "application/json" }, (opts && opts.headers) || {}),
      body: (opts && opts.body) || undefined
    }).then(async (r) => {
      const ct = r.headers.get("Content-Type") || "";
      const data = ct.includes("application/json") ? await r.json() : await r.text();
      if (!r.ok) {
        const msg = (data && data.error) ? data.error : ("HTTP " + r.status);
        const err = new Error(msg);
        err.status = r.status;
        throw err;
      }
      return data;
    });
  }

  function toastSmart(title, msg, ms) {
    if (E && typeof E.toast === "function") return E.toast(title, msg, ms);
    console.log("[toast]", title, msg);
  }
  async function confirmSmart(title, msg, okText, cancelText) {
    if (E && typeof E.confirm === "function") return await E.confirm(title, msg, okText, cancelText);
    return window.confirm(title + "\n\n" + msg);
  }
  async function modalSmart(title, bodyNode, okText, cancelText) {
    if (E && typeof E.modal === "function") return await E.modal(title, bodyNode, okText, cancelText);
    // Fallback: no real modal; treat as cancelled.
    alert("Modal not available in this runtime.");
    return false;
  }

  function mkBtnRow(...nodes) {
    return el("div", { class: "eikon-row", style: "gap:8px; align-items:center;" }, ...nodes);
  }
  function rowField(label, input, extraStyle) {
    return el("div", { class: "eikon-field", style: extraStyle || "" },
      el("div", { class: "eikon-label" }, label),
      input
    );
  }

  async function promptEntryModal(title, initial) {
    const data = Object.assign({
      entry_date: todayYmd(),
      client_name: "",
      client_id_card: "",
      client_address: "",
      medicine_name_dose: "",
      quantity: "",
      doctor_name: "",
      doctor_reg_no: "",
      prescription_serial_no: ""
    }, (initial || {}));

    const inDate = el("input", { class: "eikon-input", type: "date", value: data.entry_date });
    const inClient = el("input", { class: "eikon-input", type: "text", placeholder: "e.g. John Apap", value: data.client_name });
    const inId = el("input", { class: "eikon-input", type: "text", placeholder: "ID card no.", value: data.client_id_card });
    const inAddr = el("input", { class: "eikon-input", type: "text", placeholder: "Address", value: data.client_address });
    const inMed = el("input", { class: "eikon-input", type: "text", placeholder: "Medicine (name & dose)", value: data.medicine_name_dose });
    const inQty = el("input", {
      class: "eikon-input",
      type: "number",
      min: "1",
      step: "1",
      placeholder: "Qty",
      value: (data.quantity === null || data.quantity === undefined) ? "" : String(data.quantity)
    });
    const inDoc = el("input", { class: "eikon-input", type: "text", placeholder: "Doctor name", value: data.doctor_name });
    const inReg = el("input", { class: "eikon-input", type: "text", placeholder: "Doctor reg. no.", value: data.doctor_reg_no });
    const inSerial = el("input", { class: "eikon-input", type: "text", placeholder: "Prescription serial no.", value: data.prescription_serial_no });

    const body = el("div", null,
      el("div", { class: "eikon-help" }, "All fields are required for compliance."),
      el("div", { style: "height:10px" }),
      el("div", { class: "eikon-row" },
        rowField("Date", inDate, "min-width:180px"),
        rowField("Qty", inQty, "min-width:120px")
      ),
      el("div", { class: "eikon-row" },
        rowField("Client", inClient, "min-width:260px"),
        rowField("ID Card", inId, "min-width:180px")
      ),
      rowField("Address", inAddr),
      rowField("Medicine (name & dose)", inMed),
      el("div", { class: "eikon-row" },
        rowField("Doctor", inDoc, "min-width:260px"),
        rowField("Reg. No.", inReg, "min-width:180px")
      ),
      rowField("Prescription serial no.", inSerial)
    );

    const ok = await modalSmart(title, body, "Save", "Cancel");
    if (!ok) return null;

    const payload = {
      entry_date: (inDate.value || "").trim(),
      client_name: (inClient.value || "").trim(),
      client_id_card: (inId.value || "").trim(),
      client_address: (inAddr.value || "").trim(),
      medicine_name_dose: (inMed.value || "").trim(),
      quantity: asIntPositive(inQty.value),
      doctor_name: (inDoc.value || "").trim(),
      doctor_reg_no: (inReg.value || "").trim(),
      prescription_serial_no: (inSerial.value || "").trim()
    };

    // Basic client-side validation
    for (const [k, v] of Object.entries(payload)) {
      if (k === "quantity") {
        if (!v || v < 1) throw new Error("Quantity must be a whole number >= 1");
      } else {
        if (!v) throw new Error("Missing: " + k);
      }
    }

    return payload;
  }

  function openPrintable(url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- Module ----------
  const moduleDef = {
    id: "dda-poyc",
    title: "DDA POYC",
    subtitle: "Government supplied DDAs register",
    // Keep it simple; your sidebar supports text icons too.
    // If your runtime expects SVG, this still works because many implementations fallback to text.
    icon: "G",

    // Works for BOTH: render(ctx) OR render(root,user)
    async render(a, b) {
      const ctx = (a && a.root) ? a : null;
      const root = (ctx && ctx.root) ? ctx.root : a;
      const user = (ctx && ctx.user) ? ctx.user : b;

      if (!root || typeof root.appendChild !== "function") {
        throw new Error("Invalid render root");
      }

      const state = {
        month: thisMonth(),
        q: "",
        from: thisMonth() + "-01",
        to: todayYmd(),
        entries: []
      };

      // Layout
      const header = el("div", { class: "eikon-card" },
        el("div", { class: "eikon-title" }, "DDA POYC"),
        el("div", { class: "eikon-help" }, "Government supplied DDAs register (separate from DDA Sales).")
      );

      const monthInput = el("input", { class: "eikon-input", type: "month", value: state.month });
      const searchInput = el("input", { class: "eikon-input", type: "text", placeholder: "Search…", value: state.q });

      const fromInput = el("input", { class: "eikon-input", type: "date", value: state.from });
      const toInput = el("input", { class: "eikon-input", type: "date", value: state.to });

      const btnNew = el("button", { class: "eikon-btn eikon-btn-primary" }, "New Entry");
      const btnRefresh = el("button", { class: "eikon-btn" }, "Refresh");
      const btnGenerate = el("button", { class: "eikon-btn" }, "Generate");
      const btnPrint = el("button", { class: "eikon-btn" }, "Print");

      const controls = el("div", { class: "eikon-card" },
        el("div", { class: "eikon-row" },
          rowField("Month", monthInput, "min-width:180px"),
          rowField("Search", searchInput, "min-width:280px"),
          el("div", { class: "eikon-field", style: "min-width:120px" }, btnRefresh),
          el("div", { class: "eikon-field", style: "min-width:140px" }, btnNew)
        ),
        el("div", { class: "eikon-row", style: "margin-top:10px" },
          rowField("From", fromInput, "min-width:180px"),
          rowField("To", toInput, "min-width:180px"),
          el("div", { class: "eikon-field", style: "min-width:140px" }, btnGenerate),
          el("div", { class: "eikon-field", style: "min-width:120px" }, btnPrint)
        )
      );

      const tableCard = el("div", { class: "eikon-card" });
      const reportCard = el("div", { class: "eikon-card" },
        el("div", { class: "eikon-title" }, "Report"),
        el("div", { class: "eikon-help" }, "Generate fetches JSON; Print opens a printable report in a new tab."),
        el("div", { style: "height:8px" }),
        el("div", { class: "eikon-help" }, "No report generated yet.")
      );

      // Clear root and mount (avoid double-render issues)
      root.innerHTML = "";
      root.appendChild(header);
      root.appendChild(controls);
      root.appendChild(tableCard);
      root.appendChild(reportCard);

      function renderTable() {
        tableCard.innerHTML = "";
        tableCard.appendChild(el("div", { class: "eikon-title" }, "Entries"));

        const wrap = el("div", { class: "eikon-tablewrap", style: "margin-top:10px" });
        const table = el("table", { class: "eikon-table" });

        const thead = el("thead", null,
          el("tr", null,
            el("th", null, "Date"),
            el("th", null, "Client"),
            el("th", null, "ID Card"),
            el("th", null, "Address"),
            el("th", null, "Medicine (name & dose)"),
            el("th", null, "Qty"),
            el("th", null, "Doctor"),
            el("th", null, "Reg No."),
            el("th", null, "Prescription Serial No."),
            el("th", null, "Actions")
          )
        );

        const tbody = el("tbody");
        for (const r of (state.entries || [])) {
          const btnEdit = el("button", { class: "eikon-btn" }, "Edit");
          const btnDel = el("button", { class: "eikon-btn eikon-btn-danger" }, "Delete");

          btnEdit.addEventListener("click", async () => {
            try {
              const payload = await promptEntryModal("Edit Entry", r);
              if (!payload) return;

              await apiFetchSmart(ctx, "/dda-poyc/entries/" + r.id, {
                method: "PUT",
                body: JSON.stringify(payload)
              });

              toastSmart("Saved", "Entry updated.", 2000);
              await refresh();
            } catch (err) {
              console.error(err);
              toastSmart("Save failed", err.message || "Unknown error", 4200);
            }
          });

          btnDel.addEventListener("click", async () => {
            const ok = await confirmSmart("Delete entry", "Delete this entry?", "Delete", "Cancel");
            if (!ok) return;
            try {
              await apiFetchSmart(ctx, "/dda-poyc/entries/" + r.id, { method: "DELETE" });
              toastSmart("Deleted", "Entry deleted.", 2000);
              await refresh();
            } catch (err) {
              console.error(err);
              toastSmart("Delete failed", err.message || "Unknown error", 4200);
            }
          });

          tbody.appendChild(el("tr", null,
            el("td", null, r.entry_date || ""),
            el("td", null, r.client_name || ""),
            el("td", null, r.client_id_card || ""),
            el("td", null, r.client_address || ""),
            el("td", null, r.medicine_name_dose || ""),
            el("td", null, (r.quantity === null || r.quantity === undefined) ? "" : String(r.quantity)),
            el("td", null, r.doctor_name || ""),
            el("td", null, r.doctor_reg_no || ""),
            el("td", null, r.prescription_serial_no || ""),
            el("td", null, mkBtnRow(btnEdit, btnDel))
          ));
        }

        table.appendChild(thead);
        table.appendChild(tbody);
        wrap.appendChild(table);
        tableCard.appendChild(wrap);

        if (!state.entries || !state.entries.length) {
          tableCard.appendChild(el("div", { style: "height:8px" }));
          tableCard.appendChild(el("div", { class: "eikon-help" }, "No entries for this month."));
        }
      }

      async function refresh() {
        try {
          const out = await apiFetchSmart(
            ctx,
            "/dda-poyc/entries?month=" + encodeURIComponent(state.month) + "&q=" + encodeURIComponent(state.q || ""),
            { method: "GET" }
          );
          state.entries = (out && out.entries) ? out.entries : [];
          renderTable();
        } catch (err) {
          console.error(err);
          tableCard.innerHTML = "";
          tableCard.appendChild(el("div", { class: "eikon-title" }, "Entries"));
          tableCard.appendChild(el("div", { style: "height:8px" }));
          tableCard.appendChild(el("div", { class: "eikon-help" }, "Failed to load DDA POYC entries. " + (err.message || "")));
        }
      }

      function updateReportCard(text) {
        reportCard.innerHTML = "";
        reportCard.appendChild(el("div", { class: "eikon-title" }, "Report"));
        reportCard.appendChild(el("div", { class: "eikon-help" }, "Generate fetches JSON; Print opens a printable report in a new tab."));
        reportCard.appendChild(el("div", { style: "height:8px" }));
        reportCard.appendChild(el("div", { class: "eikon-help" }, text));
      }

      // Events
      monthInput.addEventListener("change", async () => {
        state.month = monthInput.value;
        if (state.month && /^\d{4}-\d{2}$/.test(state.month)) {
          state.from = state.month + "-01";
          fromInput.value = state.from;
        }
        await refresh();
      });

      let searchT = null;
      searchInput.addEventListener("input", () => {
        state.q = searchInput.value || "";
        if (searchT) clearTimeout(searchT);
        searchT = setTimeout(() => refresh().catch(console.error), 150);
      });

      btnRefresh.addEventListener("click", async () => { await refresh(); });

      btnNew.addEventListener("click", async () => {
        try {
          const payload = await promptEntryModal("New Entry", { entry_date: todayYmd() });
          if (!payload) return;

          await apiFetchSmart(ctx, "/dda-poyc/entries", {
            method: "POST",
            body: JSON.stringify(payload)
          });

          toastSmart("Saved", "Entry created.", 2000);
          await refresh();
        } catch (err) {
          console.error(err);
          toastSmart("Save failed", err.message || "Unknown error", 4200);
        }
      });

      btnGenerate.addEventListener("click", async () => {
        state.from = (fromInput.value || "").trim();
        state.to = (toInput.value || "").trim();
        try {
          const out = await apiFetchSmart(
            ctx,
            "/dda-poyc/report?from=" + encodeURIComponent(state.from) + "&to=" + encodeURIComponent(state.to),
            { method: "GET" }
          );
          if (!out || !out.ok) throw new Error((out && out.error) ? out.error : "Report failed");
          const count = (out.entries && out.entries.length) ? out.entries.length : 0;
          updateReportCard("Report generated. Entries: " + count);
        } catch (err) {
          console.error(err);
          updateReportCard("Report failed: " + (err.message || "Unknown error"));
          toastSmart("Report failed", err.message || "Unknown error", 4200);
        }
      });

      btnPrint.addEventListener("click", async () => {
        state.from = (fromInput.value || "").trim();
        state.to = (toInput.value || "").trim();
        const base = (E && E.apiBase) ? E.apiBase : "";
        const url = base.replace(/\/+$/, "") +
          "/dda-poyc/report/html?from=" + encodeURIComponent(state.from) +
          "&to=" + encodeURIComponent(state.to);
        openPrintable(url);
      });

      // Initial load
      await refresh();
    }
  };

  // Register like DDA Sales
  if (E && typeof E.registerModule === "function") {
    E.registerModule(moduleDef);
    console.log("[dda-poyc] registered via window.EIKON.registerModule()");
  } else {
    // fallback
    E.modules = E.modules || {};
    E.modules.ddapoyc = moduleDef;
    console.log("[dda-poyc] registered via fallback E.modules.ddapoyc");
  }
})();
