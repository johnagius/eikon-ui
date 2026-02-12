/* ui/modules.ddapoyc.js - DDA POYC */
(function () {
  "use strict";

  const E = window.EIKON;
  if (!E) throw new Error("EIKON not found");

  const el = E.el;

  function pad2(n) { return String(n).padStart(2, "0"); }
  function todayYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function thisMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }

  function asInt(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    const i = Math.floor(n);
    if (i < 1) return null;
    return i;
  }

  function rowField(label, input, extraStyle) {
    return el("div", { class: "eikon-field", style: extraStyle || "" },
      el("div", { class: "eikon-label" }, label),
      input
    );
  }

  function mkBtnRow(...nodes) {
    return el("div", { class: "eikon-row", style: "gap:8px; align-items:center;" }, ...nodes);
  }

  async function promptEntryModal(title, initial) {
    const data = Object.assign({
      entry_date: todayYmd(),
      client_name: "",
      client_id_card: "",
      item_name: "",
      quantity: "",
      notes: ""
    }, (initial || {}));

    const inDate = el("input", { class: "eikon-input", type: "date", value: data.entry_date });
    const inClient = el("input", { class: "eikon-input", type: "text", placeholder: "Client name", value: data.client_name });
    const inId = el("input", { class: "eikon-input", type: "text", placeholder: "Client ID card", value: data.client_id_card });
    const inItem = el("input", { class: "eikon-input", type: "text", placeholder: "Item / Medicine", value: data.item_name });
    const inQty = el("input", { class: "eikon-input", type: "number", min: "1", step: "1", placeholder: "Qty", value: data.quantity ? String(data.quantity) : "" });
    const inNotes = el("input", { class: "eikon-input", type: "text", placeholder: "Notes", value: data.notes });

    const body = el("div", null,
      el("div", { class: "eikon-row" },
        rowField("Date", inDate, "min-width:180px"),
        rowField("Qty", inQty, "min-width:120px")
      ),
      el("div", { class: "eikon-row" },
        rowField("Client", inClient, "min-width:260px"),
        rowField("ID", inId, "min-width:180px")
      ),
      rowField("Item / Medicine", inItem),
      rowField("Notes", inNotes)
    );

    const ok = await E.modal(title, body, "Save", "Cancel");
    if (!ok) return null;

    return {
      entry_date: (inDate.value || "").trim(),
      client_name: (inClient.value || "").trim(),
      client_id_card: (inId.value || "").trim(),
      item_name: (inItem.value || "").trim(),
      quantity: asInt(inQty.value),
      notes: (inNotes.value || "").trim()
    };
  }

  // ✅ IMPORTANT: registers under E.modules["dda-poyc"]
  E.registerModule({
    id: "dda-poyc",
    title: "DDA POYC",
    subtitle: "Government supplied DDAs register",
    icon: "G",
    order: 60,

    async render(ctx) {
      const mount = ctx.mount;   // ✅ core.js passes { mount }
      mount.innerHTML = "";

      const state = {
        month: thisMonth(),
        q: "",
        entries: []
      };

      const header = el("div", { class: "eikon-card" },
        el("div", { class: "eikon-title" }, "DDA POYC"),
        el("div", { class: "eikon-help" }, "Government supplied DDAs register")
      );

      const monthInput = el("input", { class: "eikon-input", type: "month", value: state.month });
      const searchInput = el("input", { class: "eikon-input", type: "text", placeholder: "Search…", value: state.q });

      const btnRefresh = el("button", { class: "eikon-btn" }, "Refresh");
      const btnNew = el("button", { class: "eikon-btn eikon-btn-primary" }, "New Entry");

      const controls = el("div", { class: "eikon-card" },
        el("div", { class: "eikon-row" },
          rowField("Month", monthInput, "min-width:180px"),
          rowField("Search", searchInput, "min-width:280px"),
          el("div", { class: "eikon-field" }, btnRefresh),
          el("div", { class: "eikon-field" }, btnNew)
        )
      );

      const tableCard = el("div", { class: "eikon-card" });

      mount.appendChild(header);
      mount.appendChild(controls);
      mount.appendChild(tableCard);

      function renderTable(errorText) {
        tableCard.innerHTML = "";
        tableCard.appendChild(el("div", { class: "eikon-title" }, "Entries"));

        if (errorText) {
          tableCard.appendChild(el("div", { style: "height:8px" }));
          tableCard.appendChild(el("div", { class: "eikon-help" }, errorText));
          return;
        }

        const wrap = el("div", { class: "eikon-tablewrap", style: "margin-top:10px" });
        const table = el("table", { class: "eikon-table" });

        table.appendChild(el("thead", null,
          el("tr", null,
            el("th", null, "Date"),
            el("th", null, "Client"),
            el("th", null, "ID"),
            el("th", null, "Item / Medicine"),
            el("th", null, "Qty"),
            el("th", null, "Notes"),
            el("th", null, "Actions")
          )
        ));

        const tbody = el("tbody");
        for (const r of (state.entries || [])) {
          const btnEdit = el("button", { class: "eikon-btn" }, "Edit");
          const btnDel = el("button", { class: "eikon-btn eikon-btn-danger" }, "Delete");

          btnEdit.addEventListener("click", async () => {
            const payload = await promptEntryModal("Edit Entry", r);
            if (!payload) return;
            await E.apiFetch("/dda-poyc/entries/" + r.id, { method: "PUT", body: JSON.stringify(payload) });
            await refresh();
          });

          btnDel.addEventListener("click", async () => {
            const ok = await E.confirm("Delete entry", "Delete this entry?", "Delete", "Cancel");
            if (!ok) return;
            await E.apiFetch("/dda-poyc/entries/" + r.id, { method: "DELETE" });
            await refresh();
          });

          tbody.appendChild(el("tr", null,
            el("td", null, r.entry_date || ""),
            el("td", null, r.client_name || ""),
            el("td", null, r.client_id_card || ""),
            el("td", null, r.item_name || ""),
            el("td", null, r.quantity == null ? "" : String(r.quantity)),
            el("td", null, r.notes || ""),
            el("td", null, mkBtnRow(btnEdit, btnDel))
          ));
        }

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
          const out = await E.apiFetch(
            "/dda-poyc/entries?month=" + encodeURIComponent(state.month) +
            "&q=" + encodeURIComponent(state.q || ""),
            { method: "GET" }
          );
          state.entries = out?.entries || [];
          renderTable("");
        } catch (err) {
          console.error(err);
          renderTable("Failed to load DDA POYC entries. " + (err.message || "Unknown error"));
        }
      }

      monthInput.addEventListener("change", () => {
        state.month = monthInput.value;
        refresh();
      });

      let t = null;
      searchInput.addEventListener("input", () => {
        state.q = searchInput.value || "";
        if (t) clearTimeout(t);
        t = setTimeout(refresh, 150);
      });

      btnRefresh.addEventListener("click", refresh);

      btnNew.addEventListener("click", async () => {
        const payload = await promptEntryModal("New Entry", { entry_date: todayYmd() });
        if (!payload) return;
        await E.apiFetch("/dda-poyc/entries", { method: "POST", body: JSON.stringify(payload) });
        await refresh();
      });

      await refresh();
    }
  });

  console.log("[dda-poyc] module registered");
})();
