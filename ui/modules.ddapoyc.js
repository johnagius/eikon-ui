/* ui/modules.ddapoyc.js
   Eikon - DDA POYC module (UI)
*/
(function () {
  "use strict";

  const E = window.EIKON;
  if (!E) return;

  const el = E.el ? E.el.bind(E) : null;

  // Tiny DOM helper fallback if E.el isn't present for any reason
  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") node.className = v;
        else if (k === "style") node.setAttribute("style", v);
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null) continue;
      node.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
    }
    return node;
  }

  const $el = el || h;

  function pad2(n) { return String(n).padStart(2, "0"); }
  function thisMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }
  function todayYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function asInt(v) {
    if (v === "" || v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const i = Math.floor(n);
    return i >= 1 ? i : null;
  }

  function resolveMount(arg1, arg2) {
    // Supports:
    //  - render(root, user)
    //  - render(ctx) where ctx.mount or ctx.root exists
    if (arg1 && arg1.nodeType === 1) return { mount: arg1, user: arg2 || null };
    if (arg1 && typeof arg1 === "object") {
      const mount = arg1.mount || arg1.root || arg1.el || null;
      const user = arg1.user || arg1.sessionUser || null;
      if (mount && mount.nodeType === 1) return { mount, user };
    }
    throw new Error("Invalid render mount (root/mount element not provided)");
  }

  async function openPrintableHtmlViaBlob(path) {
    // Must use E.apiFetch so Authorization header is included.
    // Then open a blob in a new tab (window.open can't send headers).
    const out = await E.apiFetch(path, { method: "GET", headers: { "Accept": "text/html" } });
    const html = (out && typeof out.text === "string") ? out.text : "";
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener");
    // Optional cleanup a bit later
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
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

    const inDate = $el("input", { class: "eikon-input", type: "date", value: data.entry_date });
    const inClient = $el("input", { class: "eikon-input", type: "text", value: data.client_name, placeholder: "e.g. John Apap" });
    const inId = $el("input", { class: "eikon-input", type: "text", value: data.client_id_card, placeholder: "ID card no." });
    const inAddr = $el("input", { class: "eikon-input", type: "text", value: data.client_address, placeholder: "Address" });
    const inMed = $el("input", { class: "eikon-input", type: "text", value: data.medicine_name_dose, placeholder: "Medicine (name & dose)" });
    const inQty = $el("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: data.quantity ? String(data.quantity) : "", placeholder: "Qty" });
    const inDoc = $el("input", { class: "eikon-input", type: "text", value: data.doctor_name, placeholder: "Doctor name" });
    const inReg = $el("input", { class: "eikon-input", type: "text", value: data.doctor_reg_no, placeholder: "Doctor reg. no." });
    const inSerial = $el("input", { class: "eikon-input", type: "text", value: data.prescription_serial_no, placeholder: "Prescription serial no." });

    const body = $el("div", null,
      $el("div", { class: "eikon-help" }, "All fields are required for compliance."),
      $el("div", { style: "height:10px" }),
      $el("div", { class: "eikon-row" },
        $el("div", { class: "eikon-field", style: "min-width:180px" }, $el("div", { class: "eikon-label" }, "Date"), inDate),
        $el("div", { class: "eikon-field", style: "min-width:120px" }, $el("div", { class: "eikon-label" }, "Qty"), inQty),
      ),
      $el("div", { class: "eikon-row" },
        $el("div", { class: "eikon-field", style: "min-width:260px" }, $el("div", { class: "eikon-label" }, "Client"), inClient),
        $el("div", { class: "eikon-field", style: "min-width:180px" }, $el("div", { class: "eikon-label" }, "ID Card"), inId),
      ),
      $el("div", { class: "eikon-field" }, $el("div", { class: "eikon-label" }, "Address"), inAddr),
      $el("div", { class: "eikon-field" }, $el("div", { class: "eikon-label" }, "Medicine (name & dose)"), inMed),
      $el("div", { class: "eikon-row" },
        $el("div", { class: "eikon-field", style: "min-width:260px" }, $el("div", { class: "eikon-label" }, "Doctor"), inDoc),
        $el("div", { class: "eikon-field", style: "min-width:180px" }, $el("div", { class: "eikon-label" }, "Reg. No."), inReg),
      ),
      $el("div", { class: "eikon-field" }, $el("div", { class: "eikon-label" }, "Prescription serial no."), inSerial),
    );

    const ok = await E.modal(title, body, "Save", "Cancel");
    if (!ok) return null;

    return {
      entry_date: (inDate.value || "").trim(),
      client_name: (inClient.value || "").trim(),
      client_id_card: (inId.value || "").trim(),
      client_address: (inAddr.value || "").trim(),
      medicine_name_dose: (inMed.value || "").trim(),
      quantity: asInt(inQty.value),
      doctor_name: (inDoc.value || "").trim(),
      doctor_reg_no: (inReg.value || "").trim(),
      prescription_serial_no: (inSerial.value || "").trim()
    };
  }

  const mod = {
    id: "dda-poyc",
    title: "DDA POYC",
    subtitle: "Government supplied DDAs register",
    icon: "G",     // keep the icon
    order: 65,     // sidebar sorting

    async render(arg1, arg2) {
      const { mount } = resolveMount(arg1, arg2);

      const state = {
        month: thisMonth(),
        q: "",
        from: thisMonth() + "-01",
        to: todayYmd(),
        entries: []
      };

      mount.innerHTML = "";

      const header = $el("div", { class: "eikon-card" },
        $el("div", { class: "eikon-title" }, "DDA POYC"),
        $el("div", { class: "eikon-help" }, "Government supplied DDAs register")
      );

      const monthInput = $el("input", { class: "eikon-input", type: "month", value: state.month });
      const searchInput = $el("input", { class: "eikon-input", type: "text", placeholder: "Search…", value: state.q });

      const fromInput = $el("input", { class: "eikon-input", type: "date", value: state.from });
      const toInput = $el("input", { class: "eikon-input", type: "date", value: state.to });

      const btnRefresh = $el("button", { class: "eikon-btn" }, "Refresh");
      const btnNew = $el("button", { class: "eikon-btn eikon-btn-primary" }, "New Entry");
      const btnGenerate = $el("button", { class: "eikon-btn" }, "Generate");
      const btnPrint = $el("button", { class: "eikon-btn" }, "Print");

      const controls = $el("div", { class: "eikon-card" },
        $el("div", { class: "eikon-row" },
          $el("div", { class: "eikon-field", style: "min-width:180px" }, $el("div", { class: "eikon-label" }, "Month"), monthInput),
          $el("div", { class: "eikon-field", style: "min-width:280px" }, $el("div", { class: "eikon-label" }, "Search"), searchInput),
          $el("div", { class: "eikon-field", style: "min-width:120px" }, btnRefresh),
          $el("div", { class: "eikon-field", style: "min-width:140px" }, btnNew)
        ),
        $el("div", { class: "eikon-row", style: "margin-top:10px" },
          $el("div", { class: "eikon-field", style: "min-width:180px" }, $el("div", { class: "eikon-label" }, "From"), fromInput),
          $el("div", { class: "eikon-field", style: "min-width:180px" }, $el("div", { class: "eikon-label" }, "To"), toInput),
          $el("div", { class: "eikon-field", style: "min-width:140px" }, btnGenerate),
          $el("div", { class: "eikon-field", style: "min-width:120px" }, btnPrint)
        )
      );

      const tableCard = $el("div", { class: "eikon-card" });
      const statusLine = $el("div", { class: "eikon-help" }, "");

      mount.appendChild(header);
      mount.appendChild(controls);
      mount.appendChild(tableCard);
      mount.appendChild(statusLine);

      function renderTable() {
        tableCard.innerHTML = "";
        tableCard.appendChild($el("div", { class: "eikon-title" }, state.month ? `Entries (${state.month})` : "Entries"));

        const wrap = $el("div", { class: "eikon-tablewrap", style: "margin-top:10px" });
        const table = $el("table", { class: "eikon-table" });

        const thead = $el("thead", null,
          $el("tr", null,
            $el("th", null, "Date"),
            $el("th", null, "Client"),
            $el("th", null, "ID"),
            $el("th", null, "Item / Medicine"),
            $el("th", null, "Qty"),
            $el("th", null, "Notes")
          )
        );

        const tbody = $el("tbody");
        for (const r of (state.entries || [])) {
          tbody.appendChild($el("tr", null,
            $el("td", null, r.entry_date || ""),
            $el("td", null, r.client_name || ""),
            $el("td", null, r.client_id_card || ""),
            $el("td", null, r.medicine_name_dose || ""),
            $el("td", null, (r.quantity == null) ? "" : String(r.quantity)),
            $el("td", null, r.notes || "")
          ));
        }

        table.appendChild(thead);
        table.appendChild(tbody);
        wrap.appendChild(table);
        tableCard.appendChild(wrap);

        if (!state.entries || !state.entries.length) {
          tableCard.appendChild($el("div", { style: "height:8px" }));
          tableCard.appendChild($el("div", { class: "eikon-help" }, "No entries for this month."));
        }
      }

      async function refresh() {
        statusLine.textContent = "";
        try {
          const out = await E.apiFetch(
            `/dda-poyc/entries?month=${encodeURIComponent(state.month)}&q=${encodeURIComponent(state.q || "")}`,
            { method: "GET" }
          );
          state.entries = out && out.entries ? out.entries : [];
          renderTable();
        } catch (err) {
          console.error(err);
          statusLine.textContent = "Failed to load DDA POYC entries. " + (err.status === 401 ? "Unauthorized" : (err.message || "Error"));
          renderTable();
        }
      }

      let searchT = null;
      searchInput.addEventListener("input", () => {
        state.q = searchInput.value || "";
        if (searchT) clearTimeout(searchT);
        searchT = setTimeout(() => refresh().catch(console.error), 150);
      });

      monthInput.addEventListener("change", () => {
        state.month = monthInput.value || "";
        refresh().catch(console.error);
      });

      btnRefresh.addEventListener("click", () => refresh().catch(console.error));

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
            `/dda-poyc/report?from=${encodeURIComponent(state.from)}&to=${encodeURIComponent(state.to)}`,
            { method: "GET" }
          );
          const count = (out && out.entries && out.entries.length) ? out.entries.length : 0;
          E.toast("Report", `Generated (${count} entries)`, 2500);
        } catch (err) {
          console.error(err);
          E.toast("Report failed", err.message || "Unknown error", 4200);
        }
      });

      btnPrint.addEventListener("click", async () => {
        state.from = fromInput.value || "";
        state.to = toInput.value || "";
        const path = `/dda-poyc/report/html?from=${encodeURIComponent(state.from)}&to=${encodeURIComponent(state.to)}`;
        try {
          await openPrintableHtmlViaBlob(path);
        } catch (err) {
          console.error(err);
          E.toast("Print failed", err.message || "Unknown error", 4200);
        }
      });

      await refresh();
    }
  };

  // Register module
  E.registerModule(mod);

  // Ensure it appears in sidebar even if shell already rendered
  try {
    if (typeof E.renderNav === "function" && E.ensureRoot && E.ensureRoot()) {
      E.renderNav();
    }
  } catch (e) {}
})();
