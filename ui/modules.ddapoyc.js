/* modules.ddapoyc.js
 * EIKON module: dda-poyc
 * IMPORTANT: core calls render({ E, mount, user, route })
 */
(function () {
  "use strict";

  const E = window.EIKON || window.E;
  if (!E || typeof E.registerModule !== "function") {
    console.error("[dda-poyc] EIKON core not found (window.EIKON.registerModule missing)");
    return;
  }

  // Small DOM helper (fallback if E.el is unavailable)
  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === "class") node.className = String(v);
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (k === "dataset" && typeof v === "object") Object.assign(node.dataset, v);
        else node.setAttribute(k, String(v));
      }
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      if (c.nodeType) node.appendChild(c);
      else node.appendChild(document.createTextNode(String(c)));
    }
    return node;
  }

  function fmtMonth(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  async function apiGet(core, path) {
    // Prefer core api if present (so auth headers/token handling stays centralized)
    if (core && typeof core.api === "function") {
      const resp = await core.api(path, { method: "GET" });
      // core.api in your logs returns parsed JSON as .resp maybe; but safest:
      return resp && resp.ok === true && resp.entries ? resp : resp;
    }

    // Fallback fetch (may fail if auth headers are required)
    const r = await fetch(path, { credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
    return j;
  }

  E.registerModule({
    id: "dda-poyc",
    title: "DDA Poyc",
    subtitle: "Government supplied DDAs register",
    icon: "G",
    order: 15,
    hash: "#dda-poyc",
    route: "dda-poyc",

    // core calls: render({ E, mount, user, route })
    render: async function render(ctx) {
      const core = ctx && ctx.E ? ctx.E : E;
      const mount = ctx && ctx.mount ? ctx.mount : null;

      if (!mount || typeof mount !== "object" || typeof mount.appendChild !== "function") {
        // Don’t throw a weird error; make it obvious what’s wrong.
        throw new TypeError(
          "[dda-poyc] Invalid mount. Expected ctx.mount to be a DOM element; got: " +
            Object.prototype.toString.call(mount)
        );
      }

      // Clear module area
      mount.innerHTML = "";

      // Use E.el if available, else fallback helper
      const el = (core && typeof core.el === "function") ? core.el.bind(core) : h;

      const state = {
        month: fmtMonth(new Date()),
        loading: false,
        error: "",
        entries: [],
        q: "",
      };

      const title = el("div", { class: "page-title" }, "DDA POYC");
      const subtitle = el(
        "div",
        { class: "page-subtitle", style: { marginTop: "4px", opacity: "0.75" } },
        "Government supplied DDAs register"
      );

      const monthInput = el("input", {
        type: "month",
        value: state.month,
        class: "input",
        style: { maxWidth: "220px" },
        onchange: async (e) => {
          state.month = e.target.value || state.month;
          await load();
        },
      });

      const searchInput = el("input", {
        type: "search",
        placeholder: "Search…",
        value: state.q,
        class: "input",
        style: { flex: "1", minWidth: "180px" },
        oninput: () => {
          state.q = searchInput.value || "";
          renderTable();
        },
      });

      const refreshBtn = el(
        "button",
        { class: "btn", onclick: () => load() },
        "Refresh"
      );

      const status = el("div", { class: "muted", style: { marginTop: "8px" } }, "");

      const toolbar = el(
        "div",
        { class: "toolbar", style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "12px" } },
        monthInput,
        searchInput,
        refreshBtn
      );

      const tableWrap = el("div", { style: { marginTop: "12px" } });
      const tableEl = el("table", { class: "table", style: { width: "100%" } });
      tableWrap.appendChild(tableEl);

      const container = el(
        "div",
        { class: "module dda-poyc", style: { padding: "12px" } },
        title,
        subtitle,
        toolbar,
        status,
        tableWrap
      );

      mount.appendChild(container);

      function setStatus() {
        if (state.loading) {
          status.textContent = "Loading…";
          status.style.color = "";
          return;
        }
        if (state.error) {
          status.textContent = state.error;
          status.style.color = "crimson";
          return;
        }
        status.textContent = state.entries.length ? `${state.entries.length} entries` : "No entries";
        status.style.color = "";
      }

      function renderTable() {
        const q = state.q.trim().toLowerCase();

        const rows = (state.entries || []).filter((r) => {
          if (!q) return true;
          const hay = JSON.stringify(r).toLowerCase();
          return hay.includes(q);
        });

        tableEl.innerHTML = "";

        const thead = el("thead", null,
          el("tr", null,
            el("th", null, "Date"),
            el("th", null, "Client"),
            el("th", null, "ID"),
            el("th", null, "Item / Medicine"),
            el("th", null, "Qty"),
            el("th", null, "Notes")
          )
        );

        const tbody = el("tbody");
        for (const r of rows) {
          tbody.appendChild(
            el("tr", null,
              el("td", null, r.entry_date ?? r.date ?? ""),
              el("td", null, r.client_name ?? r.patient_name ?? ""),
              el("td", null, r.client_id ?? r.patient_id ?? ""),
              el("td", null, r.item_name ?? r.medicine_name ?? r.medicine_name_dose ?? ""),
              el("td", null, r.qty ?? r.quantity ?? ""),
              el("td", null, r.notes ?? "")
            )
          );
        }

        tableEl.appendChild(thead);
        tableEl.appendChild(tbody);
      }

      async function load() {
        state.loading = true;
        state.error = "";
        setStatus();

        try {
          // Expected endpoint (adjust if your API uses a different path)
          const data = await apiGet(core, `/dda-poyc/entries?month=${encodeURIComponent(state.month)}`);

          // Accept a few shapes:
          // { ok:true, entries:[...] }
          // { entries:[...] }
          // { ok:true, items:[...] }
          const entries =
            (data && Array.isArray(data.entries) && data.entries) ||
            (data && Array.isArray(data.items) && data.items) ||
            (Array.isArray(data) ? data : []);

          state.entries = entries;
        } catch (err) {
          state.entries = [];
          state.error =
            "Failed to load DDA POYC entries. " +
            (err && err.message ? err.message : String(err));
        } finally {
          state.loading = false;
          setStatus();
          renderTable();
        }
      }

      await load();
    },
  });

  console.log("[dda-poyc] module registered");
})();
