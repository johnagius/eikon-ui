/* Near expiry, new layout: what expires soon, nearest first, by when; add an item; send it back to the supplier
   (creates the return, as in the classic screen). Refused, damaged and offers to other pharmacies stay in the classic screen.
   Same endpoints as the classic screen (/near-expiry/entries, /near-expiry/entries/create-return). */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], q: "", loading: false, error: "", adding: null, returning: null, saving: false, err: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var RET = { pending: "Return pending", sent: "Sent back", collected: "Collected", credited: "Credited", refused: "Refused" };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function nice(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + " " + p[0] : ""; }
  function daysUntil(s) { var p = String(s).split("-"); var t = new Date(); return Math.round((new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); }
  function group(e) {
    if (e.return_id) return "back";
    var n = daysUntil(e.expiry_date);
    return n < 0 ? "expired" : n <= 31 ? "month" : n <= 92 ? "three" : "later";
  }
  var GROUPS = [["expired", "Expired"], ["month", "Within a month"], ["three", "Within three months"], ["later", "Later"], ["back", "Being sent back"]];

  function css() {
    if (document.getElementById("eikon-nexreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-nexreg-css";
    st.textContent =
      ".nex{max-width:860px;margin:0 auto}" +
      ".nex-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".nex-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".nex h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.nex-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".nex-acts{display:flex;gap:8px}" +
      ".nex-btn{font:inherit;font-size:14px;font-weight:600;height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".nex-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.nex-btn:disabled{opacity:.55;cursor:default}" +
      ".nex-q{width:100%;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:15px;padding:0 12px;outline:0;margin-top:16px}" +
      ".nex-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:18px 2px 7px;display:flex;gap:8px}.nex-lab b{color:var(--text)}" +
      ".nex-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".nex-row{display:flex;align-items:center;gap:12px;padding:11px 16px;border-top:.5px solid var(--border);border-left:3px solid transparent}.nex-row:first-child{border-top:0}" +
      ".nex-row.expired{border-left-color:var(--danger)}.nex-row.month{border-left-color:#C98A12}" +
      ".nex-row .t{flex:1;min-width:0}.nex-row b{display:block;font-size:15px;font-weight:600}.nex-row span{display:block;font-size:12.5px;color:var(--muted)}" +
      ".nex-pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;background:rgba(127,127,127,.14);color:var(--muted)}" +
      ".nex-pill.expired{background:rgba(215,38,28,.12);color:var(--danger)}.nex-pill.month{background:rgba(201,138,18,.16);color:var(--warn,#A06A0E)}.nex-pill.back{background:rgba(10,143,106,.12);color:var(--accent)}" +
      ".nex-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}.nex-in{border-top:.5px solid var(--border);background:rgba(118,118,128,.05)}" +
      ".nex-form label,.nex-in label{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 16px;border-top:.5px solid var(--border)}.nex-form label:first-child,.nex-in label:first-child{border-top:0}" +
      ".nex-form label>span,.nex-in label>span{flex:0 0 90px;font-size:15px}.nex-form input,.nex-in input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".nex-form .acts,.nex-in .acts{display:flex;gap:8px;padding:10px 16px;justify-content:flex-end}" +
      ".nex-err{color:var(--danger);font-size:13px;padding:2px 16px 4px}" +
      ".nex-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.nex{padding:4px 16px 0}.nex h1{font-size:32px}.nex-row{flex-wrap:wrap;row-gap:8px}.nex-row .t{flex-basis:100%}.nex-row .nex-btn{margin-left:auto;height:32px}}" +
      // Stock group: a 44 px way back, a pressed state on every button, 44 px buttons on a phone, a retry under a failed load.
      ".nex-back{display:inline-flex;align-items:center;min-height:44px;padding:0 8px 0 0;margin:-8px 0 -2px}.nex-btn:active:not(:disabled){filter:brightness(.9)}" +
      ".nex-quiet .nex-btn{margin-top:12px;display:block}.nex-q{box-sizing:border-box;font-size:16px}" +
      "@media (max-width:600px){.nex-btn,.nex-row .nex-btn,.nex-q{height:44px}.nex-btn{border-radius:22px}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch("/near-expiry/entries", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the list");
      S.entries = (r.entries || []).slice().sort(function (a, b) { return String(a.expiry_date) < String(b.expiry_date) ? -1 : 1; });
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the list"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  // Suppliers this device sent stock back to, most recent first: the last one is filled in, the rest are offered.
  function sups() { try { var a = JSON.parse(localStorage.getItem("eikon_nex_suppliers") || "[]"); return Array.isArray(a) ? a.filter(function (x) { return typeof x === "string" && x; }).slice(0, 8) : []; } catch (e) { return []; } }
  function rememberSup(s) { try { var a = sups().filter(function (x) { return x.toLowerCase() !== s.toLowerCase(); }); a.unshift(s); localStorage.setItem("eikon_nex_suppliers", JSON.stringify(a.slice(0, 8))); } catch (e) {} }

  function rowHtml(e) {
    var g = group(e), n = daysUntil(e.expiry_date);
    var pill = g === "back" ? (RET[e.return_status] || "Sent back") : n === -1 ? "Expired yesterday" : n < 0 ? "Expired " + (-n) + " days ago" : n === 0 ? "Expires today" : n === 1 ? "Expires tomorrow" : "In " + n + " days";
    var sub = ["Expires " + nice(e.expiry_date)]; if (e.location) sub.push(e.location); if (e.notes) sub.push(e.notes);
    var h = '<div class="nex-row ' + g + '"><div class="t"><b>' + esc(e.product_name) + "</b><span>" + esc(sub.join(" · ")) + "</span></div>" +
      '<span class="nex-pill ' + g + '">' + esc(pill) + "</span>" + (g !== "back" && S.returning !== e.id ? '<button class="nex-btn" data-act="ret" data-id="' + e.id + '">Send back</button>' : "") + "</div>";
    if (S.returning === e.id) {
      var d = S.retDraft || { supplier: sups()[0] || "" };
      h += '<form class="nex-in" id="nex-ret" autocomplete="off"><label><span>Supplier</span><input name="supplier" list="nex-sup" value="' + esc(d.supplier || "") + '" placeholder="Who it goes back to"></label>' +
        '<label><span>Quantity</span><input name="quantity" inputmode="numeric" value="' + esc(d.quantity || "") + '" placeholder="Optional"></label>' +
        (S.err ? '<div class="nex-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="nex-btn" data-act="ret-cancel">Cancel</button><button type="submit" class="nex-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Add to returns") + "</button></div></form>";
    }
    return h;
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "nexreg") return; // left before a reply came back: do not draw over the next screen
    var locs = {}; S.entries.forEach(function (e) { if (e.location) locs[e.location] = 1; });
    var h = '<div class="nex"><button class="nex-back" data-act="back">' + esc(E.ui2BackLabel("nexreg")) + "</button>" +
      '<div class="nex-top"><div><h1>Near expiry</h1><p class="nex-sub">What expires soon, nearest first.</p></div>' +
      '<div class="nex-acts">' + (S.adding ? "" : '<button class="nex-btn p" data-act="add">Add an item</button>') + "</div></div>";
    if (S.adding) {
      var a = S.adding;
      h += '<form class="nex-form" id="nex-add" autocomplete="off"><label><span>Product</span><input name="product_name" value="' + esc(a.product_name || "") + '" placeholder="e.g. Paracetamol 500mg"></label>' +
        '<label><span>Expires</span><input name="expiry_date" type="date" value="' + esc(a.expiry_date || "") + '"></label>' +
        '<label><span>Where</span><input name="location" list="nex-locs" value="' + esc(a.location || "") + '" placeholder="e.g. Shelf A3, Fridge"></label>' +
        '<label><span>Notes</span><input name="notes" value="' + esc(a.notes || "") + '" placeholder="Optional, e.g. 10 boxes"></label>' +
        '<datalist id="nex-locs">' + Object.keys(locs).map(function (l) { return '<option value="' + esc(l) + '">'; }).join("") + "</datalist>" +
        (S.err ? '<div class="nex-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="nex-btn" data-act="add-cancel">' + (S.added ? "Done" : "Cancel") + '</button><button type="submit" class="nex-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : S.added ? "Add another" : "Add") + "</button></div></form>";
    }
    if (S.entries.length > 6) h += '<input class="nex-q" id="nex-q" type="search" aria-label="Search near expiry" placeholder="Search product, place or notes" value="' + esc(S.q) + '">';
    h += '<div id="nex-res">' + listHtml() + "</div>";
    h += '<datalist id="nex-sup">' + sups().map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") + '</datalist><p style="font-size:12.5px;color:var(--muted);margin-top:12px">Supplier refused, damaged stock and offers to other pharmacies are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    m.innerHTML = h;
    bind(m);
  }

  // The list alone: searching redraws only this, never the box being typed in.
  function listHtml() {
    var h = "", q = S.q.trim().toLowerCase();
    var shown = S.entries.filter(function (e) { return !q || [e.product_name, e.location, e.notes].some(function (v) { return String(v || "").toLowerCase().indexOf(q) >= 0; }); });
    if (S.loading && !S.entries.length) h += '<div class="nex-quiet" aria-busy="true">Opening the list…</div>';
    else if (S.error) h += '<div class="nex-quiet" role="alert">' + esc(S.error) + '<button class="nex-btn" data-act="retry">Try again</button></div>';
    else if (!S.entries.length) h += '<div class="nex-quiet">Nothing on the list. Add an item when you spot a short date on the shelf.</div>';
    else if (!shown.length) h += '<div class="nex-quiet">Nothing matches “' + esc(S.q) + "”.</div>";
    else GROUPS.forEach(function (g) {
      var list = shown.filter(function (e) { return group(e) === g[0]; });
      if (list.length) h += '<div class="nex-lab">' + g[1] + " <b>" + list.length + '</b></div><div class="nex-list">' + list.map(rowHtml).join("") + "</div>";
    });
    return h;
  }
  function focusSoon(sel) { var since = Date.now(), from = document.activeElement; setTimeout(function () { var f = S.mount && S.mount.querySelector(sel); if (f && E.focusIfIdle(f, since, from) && f.tagName === "INPUT" && f.value) try { f.select(); } catch (e) {} }, 30); } // never away from a field the person went to meanwhile

  function bind(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = E.ui2BackHash("nexreg");
        else if (a === "retry") load();
        else if (a === "add") { S.adding = {}; S.added = 0; S.err = ""; paint(); E.focusSoon(function () { return m.querySelector("[name=product_name]"); }, 30); }
        else if (a === "add-cancel") { S.adding = null; S.added = 0; S.err = ""; paint(); focusSoon('[data-act="add"]'); }
        else if (a === "ret") { S.returning = Number(b.getAttribute("data-id")); S.retDraft = null; S.err = ""; paint(); focusSoon("#nex-ret [name=supplier]"); }
        else if (a === "ret-cancel") { var id = S.returning; S.returning = null; S.err = ""; paint(); focusSoon('[data-act="ret"][data-id="' + id + '"]'); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "nexreg"); } catch (e) {} E.openClassic("nearexpiry"); }
      });
    });
    if (m !== S.mount) return; // a redrawn list: its buttons only
    var q = m.querySelector("#nex-q");
    if (q) q.addEventListener("input", function () { S.q = q.value; var res = m.querySelector("#nex-res"); if (res) { res.innerHTML = listHtml(); bind(res); } });
    var fa = m.querySelector("#nex-add"); if (fa) fa.addEventListener("submit", function (ev) { ev.preventDefault(); add(fa); });
    var fr = m.querySelector("#nex-ret"); if (fr) fr.addEventListener("submit", function (ev) { ev.preventDefault(); sendBack(fr); });
    // Escape closes the open form (what is typed in it is dropped, as with Cancel) and puts you back where you were.
    m.querySelectorAll("form").forEach(function (f) { f.addEventListener("keydown", function (ev) { if (ev.key !== "Escape") return; var c = f.querySelector('[data-act$="-cancel"]'); if (c) { ev.preventDefault(); c.click(); } }); });
  }

  var val = function (f, n) { var el = f.querySelector("[name=" + n + "]"); return el ? String(el.value || "").trim() : ""; };

  async function add(f) {
    if (S.saving) return;
    var body = { product_name: val(f, "product_name"), expiry_date: val(f, "expiry_date"), location: val(f, "location"), notes: val(f, "notes") };
    S.adding = body; S.err = "";
    if (!body.product_name) S.err = "Write the product. Nothing was saved.";
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(body.expiry_date)) S.err = "Choose the expiry date. Nothing was saved.";
    if (S.err) return paint();
    S.saving = true; paint();
    try {
      var r = await E.apiFetch("/near-expiry/entries", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      // A shelf check finds several: the form stays open for the next one, keeping where it was found.
      S.adding = { location: body.location }; S.added = (S.added || 0) + 1; E.toast("Added · " + body.product_name + " · expires " + nice(body.expiry_date), "success");
    } catch (e) { S.err = E.saveFailText(e); }
    S.saving = false; await load();
    if (S.adding && !S.err) { var f = S.mount && S.mount.querySelector("#nex-add [name=product_name]"); if (f) f.focus(); }
  }

  async function sendBack(f) {
    if (S.saving) return;
    var e = S.entries.find(function (x) { return x.id === S.returning; }); if (!e) return;
    var body = { near_expiry_id: e.id, supplier: val(f, "supplier"), quantity: val(f, "quantity") };
    S.retDraft = body; S.err = "";
    if (!body.supplier) { S.err = "Write the supplier. Nothing was saved."; return paint(); }
    S.saving = true; paint();
    try {
      var r = await E.apiFetch("/near-expiry/entries/create-return", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.returning = null; rememberSup(body.supplier); E.toast(e.product_name + " added to Returns for " + body.supplier, "success");
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "nexreg", title: "Near expiry", order: 3, icon: "⏳", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.adding = null; S.added = 0; S.returning = null; S.err = ""; css(); paint(); return E.takeOpenForm("nexreg", S.mount, load(), { btn: "[data-act=add]", form: "#nex-add" }); }

  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("nexreg") < 0) E.UI2_DESTINATIONS.push("nexreg");
  if (E.UI2_PARENT) E.UI2_PARENT.nexreg = "stock";
})();
