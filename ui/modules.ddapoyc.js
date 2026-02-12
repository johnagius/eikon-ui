/* ui/modules.ddapoyc.js
   Eikon - DDA POYC module (UI)
   Government supplied DDAs register (separate table + endpoints from DDA Sales)

   Endpoints (Cloudflare Worker):
   GET    /dda-poyc/entries?month=YYYY-MM&q=...
   POST   /dda-poyc/entries
   PUT    /dda-poyc/entries/:id
   DELETE /dda-poyc/entries/:id
   GET    /dda-poyc/report?from=YYYY-MM-DD&to=YYYY-MM-DD (JSON)
   GET    /dda-poyc/report/html?from=YYYY-MM-DD&to=YYYY-MM-DD (Printable HTML)
*/
(function () {
  "use strict";

  const E = window.EIKON;
  const el = E.el;

  function pad2(n) { return String(n).padStart(2, "0"); }
  function todayYmd() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function thisMonth() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  async function openPrintableReport(url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function asInt(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const i = Math.floor(n);
    if (i < 1) return null;
    return i;
  }

  function mkBtnRow(...nodes) {
    return el("div", { class: "eikon-row", style: "gap:8px; align-items:center;" }, ...nodes);
  }

  function rowField(label, input, extraStyle) {
    return el(
      "div",
      { class: "eikon-field", style: extraStyle || "" },
      el("div", { class: "eikon-label" }, label),
      input
    );
  }

  async function promptEntryModal(title, initial) {
    const data = Object.assign(
      {
        entry_date: todayYmd(),
        client_name: "",
        client_id_card: "",
        client_address: "",
        medicine_name_dose: "",
        quantity: "",
        doctor_name: "",
        doctor_reg_no: "",
        prescription_serial_no: "",
      },
      initial || {}
    );

    const inDate = el("input", { class: "eikon-input", type: "date", value: data.entry_date });
    const inClient = el("input", {
      class: "eikon-input",
      type: "text",
      placeholder: "e.g. John Apap",
      value: data.client_name,
    });
    const inId = el("input", {
      class: "eikon-input",
      type: "text",
      placeholder: "ID card no.",
      value: data.client_id_card,
    });
    const inAddr = el("input", {
      class: "eikon-input",
      type: "text",
      placeholder: "Address",
      value: data.client_address,
    });
    const inMed = el("input", {
      class: "eikon-input",
      type: "text",
      placeholder: "Medicine (name & dose)",
      value: data.medicine_name_dose,
    });
    const inQty = el("input", {
      class: "eikon-input",
      type: "number",
      min: "1",
      step: "1",
      placeholder: "Qty",
      value: data.quantity === null || data.quantity === undefined ? "" : String(data.quantity),
    });
    const inDoc = el("input", {
      class: "eikon-input",
      type: "text",
      placeholder: "Doctor name",
      value: data.doctor_name,
    });
    const inReg = el("input", {
      class: "eikon-input",
      type: "text",
      placeholder: "Doctor reg. no.",
      value: data.doctor_reg_no,
    });
    const inSerial = el("input", {
      class: "eikon-input",
      type: "text",
      placeholder: "Prescription serial no.",
      value: data.prescription_serial_no,
    });

    const body = el(
      "div",
      null,
      el("div", { class: "eikon-help" }, "All fields are required for compliance."),
      el("div", { style: "height:10px" }),
      el(
        "div",
        { class: "eikon-row" },
        rowField("Date", inDate, "min-width:180px"),
        rowField("Qty", inQty, "min-width:120px")
      ),
      el(
        "div",
        { class: "eikon-row" },
        rowField("Client", inClient, "min-width:260px"),
        rowField("ID Card", inId, "min-width:180px")
      ),
      rowField("Address", inAddr),
      rowField("Medicine (name & dose)", inMed),
      el(
        "div",
        { class: "eikon-row" },
        rowField("Doctor", inDoc, "min-width:260px"),
        rowField("Reg. No.", inReg, "min-width:180px")
      ),
      rowField("Prescription serial no.", inSerial)
    );

    const ok = await E.modal(title, body, "Save", "Cancel");
    if (!ok) return null;

    const payload = {
      entry_date: (inDate.value || "").trim(),
      client_name: (inClient.value || "").trim(),
      client_id_card: (inId.value || "").trim(),
      client_address: (inAddr.value || "").trim(),
      medicine_name_dose: (inMed.value || "").trim(),
      quantity: asInt(inQty.value),
      doctor_name: (inDoc.value || "").trim(),
      doctor_reg_no: (inReg.value || "").trim(),
      prescription_serial_no: (inSerial.value || "").trim(),
    };

    return payload;
  }

  const MOD = {
    // Identity
    id: "dda-poyc",

    // ✅ Router/navigation wiring (matches how dda-sales is described in your core state dump)
    key: "dda-poyc",
    slug: "dda-poyc",
    route: "dda-poyc",
    hash: "#dda-poyc",
    title: "DDA Poyc",
    navTitle: "DDA Poyc",
    subtitle: "Government supplied DDAs register",
    icon: "G",

    async render(root, user) {
      const state = {
        month: thisMonth(),
        q: "",
        from: thisMonth() + "-01",
        to: todayYmd(),
        entries: [],
      };

      const header = el(
        "div",
        { class: "eikon-card" },
        el("div", { class: "eikon-title" }, "DDA Poyc"),
        el("div", { class: "eikon-help" }, "Separate register for government supplied DDAs.")
      );

      const monthInput = el("input", { class: "eikon-input", type: "month", value: state.month });
      const searchInput = el("input", {
        class: "eikon-input",
        type: "text",
        placeholder: "Type to filter…",
        value: state.q,
      });
      const fromInput = el("input", { class: "eikon-input", type: "date", value: state.from });
      const toInput = el("input", { class: "eikon-input", type: "date", value: state.to });

      const btnNew = el("button", { class: "eikon-btn eikon-btn-primary" }, "New Entry");
      const btnRefresh = el("button", { class: "eikon-btn" }, "Refresh");
      const btnGenerate = el("button", { class: "eikon-btn" }, "Generate");
      const btnPrint = el("button", { class: "eikon-btn" }, "Print");

      const controls = el(
        "div",
        { class: "eikon-card" },
        el(
          "div",
          { class: "eikon-row" },
          rowField("Month", monthInput, "min-width:180px"),
          rowField("Search", searchInput, "min-width:280px"),
          el("div", { class: "eikon-field", style: "min-width:120px" }, btnRefresh),
          el("div", { class: "eikon-field", style: "min-width:140px" }, btnNew)
        ),
        el(
          "div",
          { class: "eikon-row", style: "margin-top:10px" },
          rowField("From", fromInput, "min-width:180px"),
          rowField("To", toInput, "min-width:180px"),
          el("div", { class: "eikon-field", style: "min-width:140px" }, btnGenerate),
          el("div", { class: "eikon-field", style: "min-width:120px" }, btnPrint)
        )
      );

      const tableCard = el("div", { class: "eikon-card" });
      const reportCard = el(
        "div",
        { class: "eikon-card" },
        el("div", { class: "eikon-title" }, "Report"),
        el(
          "div",
          { class: "eikon-help" },
          "Use Generate to fetch JSON; Print opens a printable report in a new tab."
        ),
        el("div", { style: "height:8px" }),
        el("div", { class: "eikon-help" }, "No report generated yet.")
      );

      root.appendChild(header);
      root.appendChild(controls);
      root.appendChild(tableCard);
      root.appendChild(reportCard);

      function renderTable() {
        tableCard.innerHTML = "";
        tableCard.appendChild(el("div", { class: "eikon-title" }, "Entries"));

        const wrap = el("div", { class: "eikon-tablewrap", style: "margin-top:10px" });
        const table = el("table", { class: "eikon-table" });

        const thead = el(
          "thead",
          null,
          el(
            "tr",
            null,
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

        for (const r of state.entries || []) {
          const btnEdit = el("button", { class: "eikon-btn" }, "Edit");
          const btnDel = el("button", { class: "eikon-btn eikon-btn-danger" }, "Delete");

          btnEdit.addEventListener("click", async () => {
            const payload = await promptEntryModal("Edit Entry", r);
            if (!payload) return;
            try {
              await E.apiFetch("/dda-poyc/entries/" + r.id, {
                method: "PUT",
                body: JSON.stringify(payload),
              });
              E.toast("Saved", "Entry updated.", 2000);
              await refresh();
            } catch (err) {
              console.error(err);
              E.toast("Save failed", err.message || "Unknown error", 4200);
            }
          });

          btnDel.addEventListener("click", async () => {
            const ok = await E.confirm("Delete entry", "Delete this entry?", "Delete", "Cancel");
            if (!ok) return;
            try {
              await E.apiFetch("/dda-poyc/entries/" + r.id, { method: "DELETE" });
              E.toast("Deleted", "Entry deleted.", 2000);
              await refresh();
            } catch (err) {
              console.error(err);
              E.toast("Delete failed", err.message || "Unknown error", 4200);
            }
          });

          tbody.appendChild(
            el(
              "tr",
              null,
              el("td", null, r.entry_date || ""),
              el("td", null, r.client_name || ""),
              el("td", null, r.client_id_card || ""),
              el("td", null, r.client_address || ""),
              el("td", null, r.medicine_name_dose || ""),
              el("td", null, r.quantity === null || r.quantity === undefined ? "" : String(r.quantity)),
              el("td", null, r.doctor_name || ""),
              el("td", null, r.doctor_reg_no || ""),
              el("td", null, r.prescription_serial_no || ""),
              el("td", null, mkBtnRow(btnEdit, btnDel))
            )
          );
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
        const out = await E.apiFetch(
          "/dda-poyc/entries?month=" + encodeURIComponent(state.month) + "&q=" + encodeURIComponent(state.q || ""),
          { method: "GET" }
        );
        state.entries = out && out.entries ? out.entries : [];
        renderTable();
      }

      function updateReportCard(text) {
        reportCard.innerHTML = "";
        reportCard.appendChild(el("div", { class: "eikon-title" }, "Report"));
        reportCard.appendChild(
          el(
            "div",
            { class: "eikon-help" },
            "Use Generate to fetch JSON; Print opens a printable report in a new tab."
          )
        );
        reportCard.appendChild(el("div", { style: "height:8px" }));
        reportCard.appendChild(el("div", { class: "eikon-help" }, text));
      }

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
        searchT = setTimeout(() => {
          refresh().catch(console.error);
        }, 150);
      });

      btnRefresh.addEventListener("click", async () => { await refresh(); });

      btnNew.addEventListener("click", async () => {
        const payload = await promptEntryModal("New Entry", { entry_date: todayYmd() });
        if (!payload) return;
        try {
          await E.apiFetch("/dda-poyc/entries", { method: "POST", body: JSON.stringify(payload) });
          E.toast("Saved", "Entry created.", 2000);
          await refresh();
        } catch (err) {
          console.error(err);
          E.toast("Save failed", err.message || "Unknown error", 4200);
        }
      });

      btnGenerate.addEventListener("click", async () => {
        state.from = fromInput.value || "";
        state.to = toInput.value || "";
        try {
          const out = await E.apiFetch(
            "/dda-poyc/report?from=" + encodeURIComponent(state.from) + "&to=" + encodeURIComponent(state.to),
            { method: "GET" }
          );
          if (!out || !out.ok) throw new Error(out && out.error ? out.error : "Report failed");
          const count = out.entries && out.entries.length ? out.entries.length : 0;
          updateReportCard("Report generated. Entries: " + count);
        } catch (err) {
          console.error(err);
          updateReportCard("Report failed: " + (err.message || "Unknown error"));
          E.toast("Report failed", err.message || "Unknown error", 4200);
        }
      });

      btnPrint.addEventListener("click", async () => {
        state.from = fromInput.value || "";
        state.to = toInput.value || "";
        const url =
          E.apiBase.replace(/\/+$/, "") +
          "/dda-poyc/report/html?from=" +
          encodeURIComponent(state.from) +
          "&to=" +
          encodeURIComponent(state.to);
        await openPrintableReport(url);
      });

      await refresh();
    },
  };

  // Register with core/router
  if (typeof E.registerModule === "function") {
    E.registerModule(MOD);
    if (E && E.log) E.log("[dda-poyc] registered via E.registerModule()");
    else console.log("[EIKON][dda-poyc] registered via E.registerModule()");
  } else {
    E.modules = E.modules || {};
    E.modules[MOD.id] = MOD;
    E.modules.ddapoyc = MOD;
    console.log("[EIKON][dda-poyc] registered via fallback registry");
  }
})();
