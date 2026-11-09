/* Controlled-drug stock takes (DDA stock takes), new layout. The last classic register rebuilt: same routes, same bodies.
   The list of stock takes, newest first; open one to count it. Each line is a medicine (name and dosage, as in the
   classic) with a large count box: type the number of tablets, Enter saves it and moves to the next line. A line can
   be added, and its name or dosage changed. "Save and close" and Print do what the classic buttons do.
   What the classic shows is what this shows: name, dosage and quantity of tablets. There is no expected or previous
   count in the classic, so none here. Deleting a line stays in the classic screen.
   Routes (all already used by modules.ddastocktakes.js, bodies byte for byte the same):
     GET  /dda-stocktakes/stocktakes                 list
     POST /dda-stocktakes/stocktakes {}              start one (postOnce: a lost answer is checked in the list)
     GET  /dda-stocktakes/stocktakes/:id             one with its items
     PUT  /dda-stocktakes/stocktakes/:id {closed:1}  close (ACTION, idempotent)
     POST /dda-stocktakes/stocktakes/:id/items {item_name,dosage,qty_tablets}        (postOnce)
     PUT  /dda-stocktakes/items/:id {ok,item_name,dosage,qty_tablets}  FULL-REPLACE: the whole line as read is sent,
          with only what was changed. The classic sends its validation result, which carries "ok": true; kept so the
          body is the classic's exactly (the worker ignores it).
     GET  /dda-stocktakes/stocktakes/:id/report/html print, opened the classic way (Blob in a new tab). */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var ID = "ddstreg", API = "/dda-stocktakes";
  var S = { mount: null, list: [], loading: false, error: "", openId: null, cur: null, curErr: "", rows: {}, adding: null, addErr: "", addSaving: false,
    editId: null, edit: null, editErr: "", editSaving: false, creating: false, createErr: "", closing: false, closeErr: "", printing: false };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function when(s) { // "2026-11-03 10:12:40" (UTC, as stored) -> "3 Nov 2026, 10:12" in the same clock the classic prints
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ""));
    return m ? Number(m[3]) + " " + MON[Number(m[2]) - 1] + " " + m[1] + ", " + m[4] + ":" + m[5] : String(s || "");
  }
  function day(s) { var w = when(s); return w.split(",")[0]; }
  function whole(v) { // the classic's rule (a number, 0 or more), whole tablets only: "2.5" is refused rather than cut to 2
    var t = String(v == null ? "" : v).trim().replace(",", ".");
    if (t === "") return null;
    var n = Number(t);
    return Number.isFinite(n) && n >= 0 && Math.floor(n) === n ? n : NaN;
  }
  function itemBody(it, qty) { return { ok: true, item_name: String(it.item_name || "").trim(), dosage: String(it.dosage || "").trim(), qty_tablets: Math.floor(qty) }; }
  function failText(x) { return x && x.network ? E.saveFailText(x) : (E.saveFailText ? E.saveFailText(x) : "Not saved: " + String((x && (x.message || x)) || "error")); }

  function css() {
    if (document.getElementById("eikon-ddst-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-ddst-css";
    st.textContent =
      ".dst{max-width:880px;margin:0 auto}" +
      ".dst-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 8px 0 0;margin-bottom:2px;min-height:44px;cursor:pointer}" +
      ".dst-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".dst h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.dst-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".dst-btn{font:inherit;font-size:14px;font-weight:600;min-height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".dst-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.dst-btn:disabled{opacity:.55;cursor:default}.dst-btn.t{border:0;background:none;color:var(--accent);padding:0 6px}" +
      ".dst-acts{display:flex;flex-direction:row-reverse;gap:8px;flex-wrap:wrap;align-items:center}" +
      ".dst-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.dst-lab b{color:var(--text)}" +
      ".dst-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".dst-st{display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;min-height:52px;padding:8px 16px;border:0;border-top:.5px solid var(--border);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}" +
      ".dst-st:first-child{border-top:0}.dst-st b{font-size:15px;font-weight:600;display:block}.dst-st span{font-size:12.5px;color:var(--muted)}.dst-st em{font-style:normal;color:var(--accent);font-size:20px}" +
      ".dst-pill{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:9px;background:var(--bg);color:var(--muted);margin-left:6px}.dst-pill.o{color:var(--accent)}" +
      ".dst-meta{color:var(--muted);font-size:13.5px;margin:6px 0 0}" +
      ".dst-items{background:var(--panel2);border:1px solid var(--border);border-radius:14px;margin-top:10px;overflow:hidden}" +
      ".dst-items .hd{display:flex;justify-content:space-between;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:10px 16px 6px}" +
      ".dst-items .row{display:flex;align-items:center;gap:12px;min-height:60px;padding:6px 10px 6px 16px;border-top:.5px solid var(--border)}" +
      ".dst-items .nm{flex:1;min-width:0}.dst-items .nm b{display:block;font-size:15.5px;font-weight:600;overflow-wrap:anywhere}.dst-items .nm span{font-size:13px;color:var(--muted)}" +
      ".dst-items .nm small{display:block;font-size:12px;font-weight:600;color:var(--accent);margin-top:2px}.dst-items .nm small.bad{color:var(--danger)}" +
      ".dst-cnt{flex:0 0 112px;width:112px;height:48px;box-sizing:border-box;border:1.5px solid var(--border);border-radius:10px;background:var(--panel);color:var(--text);font:inherit;font-size:22px;font-weight:600;font-variant-numeric:tabular-nums;text-align:right;padding:0 12px}" +
      ".dst-cnt:focus{outline:3px solid rgba(10,143,106,.5);outline-offset:1px;border-color:var(--accent)}.dst-cnt[aria-invalid=true]{border-color:var(--danger)}" +
      ".dst-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:14px}" +
      ".dst-form .t{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:8px 14px 4px}" +
      ".dst-form label{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 14px;border-top:.5px solid var(--border)}" +
      ".dst-form label>span{flex:0 0 96px;font-size:15px}.dst-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".dst-form input.q{flex:0 0 112px;margin-left:auto;text-align:right;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}" +
      ".dst-form input[aria-invalid=true]::placeholder{color:var(--danger)}.dst-form label:has(input[aria-invalid=true]):not(:focus-within)>span{color:var(--danger)}" +
      ".dst-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end;align-items:center;flex-wrap:wrap}" +
      ".dst-err{color:var(--danger);font-size:13px;padding:4px 14px}.dst-top .dst-err{padding:4px 0}" +
      ".dst-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".dst-acts .dst-btn{min-height:44px;border-radius:22px}.dst-bymed{display:inline-flex;align-items:center;text-decoration:none}" +
      ".dst-ny{display:flex;flex-wrap:wrap;gap:6px}.dst-ny .dst-btn{min-height:44px}" +
      ".dst-foot{font-size:12.5px;color:var(--muted);margin-top:12px}" +
      "@media (max-width:600px){.dst{padding:4px 16px 0}.dst h1{font-size:28px}.dst-form label>span{flex-basis:78px}.dst-cnt,.dst-form input.q{flex-basis:96px;width:96px}}";
    document.head.appendChild(st);
  }

  function here() { return E.state.activeModuleId === ID; }
  async function getList() {
    var r = await E.apiFetch(API + "/stocktakes", { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the stock takes");
    return r.stocktakes || [];
  }
  async function getOne(id) {
    var r = await E.apiFetch(API + "/stocktakes/" + encodeURIComponent(id), { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not open the stock take");
    return r;
  }
  function loadErr(e, what) { return e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || what); }

  async function loadList() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paintIdle();
    try { S.list = await getList(); }
    catch (e) { if (!keepView || !S.list.length) S.error = loadErr(e, "Could not load the stock takes"); }
    S.loading = false; paintIdle();
  }
  async function loadOne(id, now) {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.curErr = "";
    if (!S.cur || String(S.cur.stocktake.id) !== String(id)) { S.cur = null; S.rows = {}; }
    if (now) paint(); else paintIdle();
    try {
      var r = await getOne(id);
      if (String(S.openId) !== String(id)) return; // another one was opened meanwhile
      S.cur = { stocktake: r.stocktake, items: r.items || [] };
      Object.keys(S.rows).forEach(function (k) { // a line that is no longer there (deleted in classic) drops its typing
        if (!S.cur.items.some(function (it) { return String(it.id) === k; })) delete S.rows[k];
      });
    } catch (e) { if (!keepView || !S.cur) S.curErr = loadErr(e, "Could not open the stock take"); }
    if (now) paint(); else paintIdle();
  }
  function paintIdle() { if (S.mount) E.whenFormIdle(S.mount, paint); }

  function item(id) { return S.cur && S.cur.items.filter(function (it) { return String(it.id) === String(id); })[0]; }
  function row(id) { return S.rows[id] || (S.rows[id] = { val: null, state: "", msg: "", sending: false, again: false }); }

  // What is typed survives every repaint: counts not yet saved, the add form and the change form.
  function keep() {
    var m = S.mount; if (!m) return;
    m.querySelectorAll("input.dst-cnt[data-id]").forEach(function (el) {
      var id = el.getAttribute("data-id"), it = item(id), r = row(id), v = String(el.value);
      var stored = it && it.qty_tablets != null ? String(it.qty_tablets) : "";
      r.val = v.trim() === stored ? null : v; // null: shows what is stored
    });
    var a = m.querySelector("#dst-add");
    if (a && S.adding) ["item_name", "dosage", "qty_tablets"].forEach(function (k) { var el = a.querySelector("[name=" + k + "]"); if (el) S.adding[k] = el.value; });
    var f = m.querySelector("#dst-edit");
    if (f && S.edit) ["item_name", "dosage", "qty_tablets"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.edit[k] = el.value; });
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (!here()) return; // left before a reply came back: do not draw over the next screen
    keep();
    var ae = document.activeElement, focusKey = ae && m.contains(ae) ? (ae.getAttribute("data-fk") || "") : "", selS = null, selE = null;
    try { if (focusKey && ae.selectionStart != null) { selS = ae.selectionStart; selE = ae.selectionEnd; } } catch (e0) {}
    var h = '<div class="dst">';
    if (!S.openId) h += listHtml(); else h += oneHtml();
    h += "</div>";
    m.innerHTML = h;
    wire(m);
    if (focusKey) { var back = m.querySelector('[data-fk="' + focusKey + '"]'); if (back) { back.focus(); try { if (selS != null) back.setSelectionRange(selS, selE); } catch (e1) {} } }
  }

  function listHtml() {
    var h = '<button class="dst-back" data-act="back" data-fk="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel(ID) : "‹ Registers") + "</button>" +
      '<div class="dst-top"><div><h1>Controlled drug stock takes</h1><p class="dst-sub">Count each controlled drug and keep the count on file, ready to print.</p></div>' +
      '<div class="dst-acts"><button class="dst-btn p" data-act="new" data-fk="new"' + (S.creating ? " disabled" : "") + ">" + (S.creating ? "Starting…" : "Start a stock take") + '</button><a class="dst-btn dst-bymed" href="#cdreg">By medicine</a></div></div>'; // the main button first in Tab order (right after the heading), drawn on the right
    if (S.createErr) h += '<div class="dst-err" role="alert">' + esc(S.createErr) + "</div>";
    if (S.loading && !S.list.length) return h + '<div class="dst-quiet">Opening the stock takes…</div>' + foot();
    if (S.error) return h + '<div class="dst-quiet">' + esc(S.error) + "</div>" + foot();
    if (!S.list.length) return h + '<div class="dst-quiet">No stock takes yet. Start one to count the controlled drugs. <button class="dst-btn p" data-act="new" style="margin-left:6px"' + (S.creating ? " disabled" : "") + '>Start a stock take</button></div>' + foot();
    h += '<div class="dst-lab"><span><b>' + S.list.length + "</b> " + (S.list.length === 1 ? "stock take" : "stock takes") + "</span></div>";
    h += '<div class="dst-list">' + S.list.map(function (st) {
      var n = Number(st.item_count || 0);
      return '<button class="dst-st" data-act="open" data-id="' + esc(st.id) + '" data-fk="open-' + esc(st.id) + '"><div><b>' + esc(when(st.created_at)) +
        (st.closed_at ? '<span class="dst-pill">Closed</span>' : '<span class="dst-pill o">Not closed</span>') + "</b><span>" +
        (n === 1 ? "1 item" : n + " items") + (st.closed_at ? " · closed " + esc(when(st.closed_at)) : "") + '</span></div><em aria-hidden="true">›</em></button>';
    }).join("") + "</div>";
    return h + foot();
  }

  function foot() {
    return '<p class="dst-foot">Deleting a line is in the <a href="#" data-act="classic" data-fk="classic" style="color:var(--accent)">classic screen</a>.</p>';
  }

  function oneHtml() {
    var h = '<button class="dst-back" data-act="list" data-fk="list">‹ All stock takes</button>';
    if (!S.cur) {
      h += '<div class="dst-top"><div><h1>Stock take</h1></div></div>';
      return h + '<div class="dst-quiet">' + esc(S.curErr || "Opening the stock take…") + "</div>" + foot();
    }
    var st = S.cur.stocktake, items = S.cur.items, closed = !!st.closed_at;
    h += '<div class="dst-top"><div><h1>Stock take of ' + esc(day(st.created_at)) + '</h1><p class="dst-meta">Created ' + esc(when(st.created_at)) +
      (closed ? " · Closed " + esc(when(st.closed_at)) : " · Not closed") + "</p></div>" +
      '<div class="dst-acts"><button class="dst-btn" data-act="print" data-fk="print"' + (S.printing ? " disabled" : "") + ">" + (S.printing ? "Preparing…" : "Print") + "</button>" +
      (closed ? "" : '<button class="dst-btn p" data-act="close" data-fk="close"' + (S.closing ? " disabled" : "") + ">" + (S.closing ? "Closing…" : "Save and close") + "</button>") + "</div></div>";
    if (S.closeErr) h += '<div class="dst-err" role="alert">' + esc(S.closeErr) + "</div>";
    if (S.curErr) h += '<div class="dst-err" role="alert">' + esc(S.curErr) + "</div>";
    if (closed) h += '<p class="dst-meta">Closed stock takes can still be corrected, as in the classic screen.</p>';

    h += '<div class="dst-lab">Items <b>' + items.length + "</b></div>";
    if (!items.length) h += '<div class="dst-quiet">No items yet. Add the first one below.</div>';
    else {
      h += '<form class="dst-items" id="dst-count" autocomplete="off" novalidate><div class="hd"><span>Name and dosage</span><span>Tablets</span></div>' + items.map(function (it, i) {
        var r = S.rows[it.id] || {}, id = String(it.id);
        if (S.editId === id) return editHtml(it);
        var v = r.val != null ? r.val : (it.qty_tablets == null ? "" : String(it.qty_tablets));
        var status = r.state === "saving" ? "Saving…" : r.state === "saved" ? "Saved" : r.state === "bad" ? r.msg : "";
        return '<div class="row"><div class="nm"><b id="dst-n-' + esc(id) + '">' + esc(it.item_name) + "</b>" + (it.dosage ? "<span>" + esc(it.dosage) + "</span>" : "") +
          '<small role="status" id="dst-s-' + esc(id) + '"' + (r.state === "bad" ? ' class="bad"' : "") + ">" + esc(status) + "</small></div>" +
          '<input class="dst-cnt" data-id="' + esc(id) + '" data-i="' + i + '" data-fk="cnt-' + esc(id) + '" inputmode="numeric" enterkeyhint="next" value="' + esc(v) + '"' +
          ' aria-label="Tablets counted, ' + esc(it.item_name + (it.dosage ? " " + it.dosage : "")) + '" aria-describedby="dst-s-' + esc(id) + '"' + (r.state === "bad" ? ' aria-invalid="true"' : "") + ">" +
          '<button type="button" class="dst-btn t" data-act="edit" data-id="' + esc(id) + '" data-fk="edit-' + esc(id) + '" aria-label="Change ' + esc(it.item_name) + '">Change</button></div>';
      }).join("") + "</form>";
    }

    if (!closed) h += '<div id="dst-nyslot">' + notYetHtml(items) + "</div>";
    var a = S.adding || (S.adding = { item_name: "", dosage: "", qty_tablets: "" }), ab = S.addErr ? S.addBad : "", inv = function (k) { return ab === k ? ' aria-invalid="true"' : ""; };
    h += '<form class="dst-form" id="dst-add" autocomplete="off" novalidate><div class="t">Add an item</div>' +
      '<label><span>Name</span><input name="item_name" data-fk="add-name" value="' + esc(a.item_name) + '" placeholder="e.g. Morphine sulphate" aria-label="Name"' + inv("add-name") + '></label>' +
      '<label><span>Dosage</span><input name="dosage" data-fk="add-dosage" list="dst-dosages" value="' + esc(a.dosage) + '" placeholder="e.g. 10mg"></label>' +
      '<label><span>Tablets</span><input class="q" name="qty_tablets" data-fk="add-qty" inputmode="numeric" enterkeyhint="done" value="' + esc(a.qty_tablets) + '" placeholder="0"' + inv("add-qty") + '></label>' +
      (S.addErr ? '<div class="dst-err" role="alert">' + esc(S.addErr) + "</div>" : "") +
      '<div class="acts"><button type="submit" class="dst-btn p" data-fk="add-go"' + (S.addSaving ? " disabled" : "") + ">" + (S.addSaving ? "Adding…" : "Add item") + "</button></div>" +
      '<datalist id="dst-dosages">' + known("dosage").map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist></form>";
    return h + foot();
  }

  // "Not counted yet" (open stock takes only): the controlled drugs received, supplied, POYC or counted since the stock
  // take before this one that have no line here yet. One read (GET /dda-register/medicines, bounded by those dates),
  // once per stock take opened. A tap only fills the Add an item form (name and dosage); nothing is saved until Add item.
  function splitName(nm) { var w = String(nm || "").trim().split(/\s+/), i = 1; while (i < w.length && !/\d/.test(w[i])) i++; return { item_name: w.slice(0, i).join(" "), dosage: w.slice(i).join(" ") }; }
  function notYetHtml(items) {
    var ny = S.notYet; if (!ny || ny.id !== String(S.openId) || !ny.list || !E.cdLedger) return "";
    var K = E.cdLedger.key, have = {};
    items.forEach(function (it) { have[K(String(it.item_name || "") + " " + String(it.dosage || ""))] = 1; });
    var left = ny.list.filter(function (x) { return !have[x.key]; });
    if (!left.length) return "";
    return '<div class="dst-lab">Not counted yet <b>' + left.length + '</b></div><p class="dst-meta" style="margin:0 2px 8px">Received, supplied or counted since ' + esc(day(String(ny.since || "") + " 00:00")) + ", and no line here yet. Tap one to add it.</p>" +
      '<div class="dst-ny">' + left.map(function (x) { return '<button type="button" class="dst-btn" data-ny="' + esc(x.key) + '" data-fk="ny-' + esc(x.key) + '">' + esc(x.item_name + (x.dosage ? " " + x.dosage : "")) + "</button>"; }).join("") + "</div>";
  }
  async function loadNotYet() {
    var id = String(S.openId), st = S.cur && S.cur.stocktake; if (!st || st.closed_at || !E.cdLedger) return;
    if (S.notYet && S.notYet.id === id) return;
    var prev = S.list.filter(function (x) { return String(x.id) !== id && x.closed_at && String(x.created_at) < String(st.created_at); })[0]; // the list is newest first
    var since = prev ? String(prev.created_at).slice(0, 10) : "";
    S.notYet = { id: id, since: since, list: null };
    try {
      var r = await E.apiFetch("/dda-register/medicines?" + (since ? "from=" + since + "&" : "") + "to=" + (E.maltaYmd ? E.maltaYmd(new Date()) : ""), { method: "GET" });
      if (!r || !r.ok || String(S.openId) !== id) return;
      if (!since) S.notYet.since = r.from;
      var K = E.cdLedger.key, map = {};
      var add = function (nm, parts) { var k = K(nm); if (k && !map[k]) map[k] = Object.assign({ key: k }, parts || splitName(nm)); };
      (r.counted || []).forEach(function (x) { add(String(x.item_name || "") + " " + String(x.dosage || ""), { item_name: String(x.item_name || "").trim(), dosage: String(x.dosage || "").trim() }); });
      [].concat(r.received || [], r.supplied || [], r.poyc || []).forEach(function (x) { add(x.name); });
      S.notYet.list = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return (a.item_name + a.dosage).localeCompare(b.item_name + b.dosage); });
      fillNotYet(); // in place: the count boxes and the form are left as they are (focus stays where it is)
    } catch (e) {}
  }
  function fillNotYet() { var slot = S.mount && S.mount.querySelector("#dst-nyslot"); if (!slot || !S.cur) return; slot.innerHTML = notYetHtml(S.cur.items); wireNotYet(slot); }

  function editHtml(it) {
    var e = S.edit, id = String(it.id);
    return '<div id="dst-edit" class="dst-form" style="margin:8px 10px;border-radius:12px" role="group" aria-label="Change ' + esc(it.item_name) + '"><div class="t">Change this line</div>' +
      '<label><span>Name</span><input name="item_name" data-fk="ed-name" value="' + esc(e.item_name) + '"' + (S.editErr && /^Write the name/.test(S.editErr) ? ' aria-invalid="true"' : "") + '></label>' +
      '<label><span>Dosage</span><input name="dosage" data-fk="ed-dosage" value="' + esc(e.dosage) + '"></label>' +
      '<label><span>Tablets</span><input class="q" name="qty_tablets" data-fk="ed-qty" inputmode="numeric" value="' + esc(e.qty_tablets) + '"' + (S.editErr && /^Write (the number|a whole number) of tablets/.test(S.editErr) ? ' aria-invalid="true"' : "") + '></label>' +
      (S.editErr ? '<div class="dst-err" role="alert">' + esc(S.editErr) + "</div>" : "") +
      '<div class="acts"><button type="button" class="dst-btn" data-act="edit-cancel" data-fk="ed-cancel">Cancel</button><button type="button" class="dst-btn p" data-act="edit-save" data-id="' + esc(id) + '" data-fk="ed-save"' + (S.editSaving ? " disabled" : "") + ">" + (S.editSaving ? "Saving…" : "Save") + "</button></div></div>";
  }

  function known(k) { // what this stock take already holds, for suggestions
    var seen = {}, out = [];
    ((S.cur && S.cur.items) || []).forEach(function (it) { var v = String(it[k] || "").trim(); if (v && !seen[v.toLowerCase()]) { seen[v.toLowerCase()] = 1; out.push(v); } });
    return out.sort(function (x, y) { return x.localeCompare(y); });
  }

  function wireNotYet(m) {
    m.querySelectorAll("[data-ny]").forEach(function (b) { b.addEventListener("click", function () { // fill the Add an item form, then the tablets box
      var x = S.notYet && (S.notYet.list || []).filter(function (y) { return y.key === b.getAttribute("data-ny"); })[0]; if (!x) return;
      var f = S.mount.querySelector("#dst-add"); if (!f) return; // filled in place (a repaint would read the empty form back)
      f.querySelector("[name=item_name]").value = x.item_name; f.querySelector("[name=dosage]").value = x.dosage; f.querySelector("[name=qty_tablets]").value = "";
      S.adding = { item_name: x.item_name, dosage: x.dosage, qty_tablets: "" };
      var q = S.mount.querySelector('[data-fk="add-qty"]'); if (q) { q.focus(); if (q.scrollIntoView) try { q.scrollIntoView({ block: "center" }); } catch (e) {} }
    }); });
  }
  function wire(m) {
    wireNotYet(m);
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
        if (act === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash(ID) : "#registers";
        else if (act === "new") create();
        else if (act === "open") { open(id); }
        else if (act === "list") { keep(); S.openId = null; S.cur = null; S.rows = {}; S.adding = null; S.addErr = ""; S.editId = null; S.closeErr = ""; S.curErr = ""; paint(); loadList(); focusSoon('[data-fk="new"]'); }
        else if (act === "print") print();
        else if (act === "close") closeIt();
        else if (act === "edit") { keep(); var it = item(id); if (!it) return; S.editId = String(id); S.editErr = ""; S.edit = { item_name: String(it.item_name || ""), dosage: String(it.dosage || ""), qty_tablets: it.qty_tablets == null ? "" : String(it.qty_tablets) }; paint(); focusSoon('[data-fk="ed-name"]'); }
        else if (act === "edit-cancel") { var was = S.editId; S.editId = null; S.edit = null; S.editErr = ""; paint(); focusSoon('[data-fk="edit-' + was + '"]'); }
        else if (act === "edit-save") saveEdit(id);
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", ID); } catch (x) {} E.openClassic("dda_stocktakes"); }
      });
    });
    m.querySelectorAll("input.dst-cnt").forEach(function (el) {
      el.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        commit(el);
        var all = [].slice.call(m.querySelectorAll("input.dst-cnt")), i = all.indexOf(el), next = all[i + 1] || m.querySelector('[data-fk="add-name"]');
        if (next) { next.focus(); try { next.select(); } catch (e) {} }
      });
      el.addEventListener("change", function () { commit(el); });
      el.addEventListener("focus", function () { try { el.select(); } catch (e) {} });
    });
    var c = m.querySelector("#dst-count"); if (c) c.addEventListener("submit", function (ev) { ev.preventDefault(); });
    var a = m.querySelector("#dst-add");
    if (a) {
      a.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
      var nm = a.querySelector("[name=item_name]");
      // generic or brand ("ativ" offers Lorazepam); no past months are read (back: []), and no fixed "name strength" list,
      // because the stock take keeps the dosage in its own box
      if (nm && E.ddaMedSuggest) E.ddaMedSuggest(nm, { path: API, field: "item_name", fixed: [], back: [], known: function () { return known("item_name"); } });
    }
    var f = m.querySelector("#dst-edit");
    if (f) f.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && ev.target && ev.target.tagName === "INPUT") { ev.preventDefault(); saveEdit(S.editId); }
      else if (ev.key === "Escape") { ev.preventDefault(); var was = S.editId; S.editId = null; S.edit = null; S.editErr = ""; paint(); focusSoon('[data-fk="edit-' + was + '"]'); }
    });
  }
  function focusSoon(sel) { E.focusSoon(function () { return S.mount && S.mount.querySelector(sel); }); } // never away from a field the person went to meanwhile
  function setStatus(id) { // only the line's status changes: the count boxes are never redrawn under the fingers
    var r = row(id), s = S.mount && S.mount.querySelector("#dst-s-" + id), inp = S.mount && S.mount.querySelector('input.dst-cnt[data-id="' + id + '"]');
    if (s) { s.textContent = r.state === "saving" ? "Saving…" : r.state === "saved" ? "Saved" : r.state === "bad" ? r.msg : ""; s.className = r.state === "bad" ? "bad" : ""; }
    if (inp) { if (r.state === "bad") inp.setAttribute("aria-invalid", "true"); else inp.removeAttribute("aria-invalid"); }
  }

  // A count: saved when Enter is pressed or the box is left. One save per line at a time; the latest number wins.
  function commit(el) {
    var id = el.getAttribute("data-id"), it = item(id); if (!it) return;
    var r = row(id), v = String(el.value), n = whole(v);
    if (n === null || isNaN(n)) { r.val = v; r.state = "bad"; r.msg = n === null ? "Write the number of tablets (0 if none)." : "Write a whole number of tablets."; return setStatus(id); }
    if (Number(it.qty_tablets) === n && !r.sending) { r.val = null; if (r.state === "bad") { r.state = ""; r.msg = ""; } return setStatus(id); }
    r.val = v; r.want = n;
    if (r.sending) { r.again = true; return; }
    sendCount(id);
  }
  async function sendCount(id) {
    var it = item(id), r = row(id); if (!it) return;
    var n = r.want, body = itemBody(it, n);
    r.sending = true; r.again = false; r.state = "saving"; setStatus(id);
    var ok = false, msg = "";
    try {
      var res = await E.apiFetch(API + "/items/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res || !res.ok) throw new Error((res && res.error) || "Save failed");
      ok = true;
    } catch (x) {
      msg = failText(x);
      if (x && x.network) ok = await stored(id, body); // the answer was lost: the line says whether it arrived
    }
    r.sending = false;
    var cur = item(id);
    if (ok) {
      if (cur) cur.qty_tablets = body.qty_tablets;
      if (r.again && r.want !== body.qty_tablets) return sendCount(id);
      var inp = S.mount && S.mount.querySelector('input.dst-cnt[data-id="' + id + '"]');
      if (!inp || whole(inp.value) === body.qty_tablets) r.val = null;
      r.state = "saved"; r.msg = "";
    } else { r.state = "bad"; r.msg = msg.replace(/^Not saved: /, "Not saved: "); }
    setStatus(id);
  }
  async function stored(id, body) {
    try {
      var one = await getOne(S.openId), it = (one.items || []).filter(function (x) { return String(x.id) === String(id); })[0];
      return !!it && String(it.item_name) === body.item_name && String(it.dosage || "") === body.dosage && Number(it.qty_tablets) === body.qty_tablets;
    } catch (e) { return false; }
  }

  async function saveEdit(id) {
    if (S.editSaving || !S.edit) return;
    keep();
    var it = item(id); if (!it) return;
    var name = String(S.edit.item_name || "").trim(), n = whole(S.edit.qty_tablets);
    S.editErr = !name ? "Write the name. Nothing was saved." : n === null ? "Write the number of tablets (0 if none). Nothing was saved." : isNaN(n) ? "Write a whole number of tablets. Nothing was saved." : "";
    if (S.editErr) { paint(); return focusSoon(!name ? '[data-fk="ed-name"]' : '[data-fk="ed-qty"]'); }
    var body = itemBody({ item_name: name, dosage: S.edit.dosage }, n);
    S.editSaving = true; paint();
    var ok = false;
    try {
      var res = await E.apiFetch(API + "/items/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res || !res.ok) throw new Error((res && res.error) || "Save failed");
      ok = true;
    } catch (x) { S.editErr = failText(x); if (x && x.network) ok = await stored(id, body); }
    S.editSaving = false;
    if (ok) { S.editId = null; S.edit = null; S.editErr = ""; delete S.rows[id]; E.toast && E.toast("Line changed", "success"); await loadOne(S.openId, true); focusSoon('[data-fk="edit-' + id + '"]'); }
    else paint();
  }

  async function add() {
    if (S.addSaving || !S.openId) return;
    keep();
    var a = S.adding, name = String(a.item_name || "").trim(), dosage = String(a.dosage || "").trim(), n = whole(a.qty_tablets);
    S.addErr = !name ? "Write the name. Nothing was added." : n === null ? "Write the number of tablets (0 if none). Nothing was added." : isNaN(n) ? "Write a whole number of tablets. Nothing was added." : "";
    S.addBad = !name ? "add-name" : "add-qty";
    if (S.addErr) { paint(); return focusSoon('[data-fk="' + S.addBad + '"]'); }
    var body = { item_name: name, dosage: dosage, qty_tablets: Math.floor(n) }, stId = S.openId;
    S.addSaving = true; paint();
    try {
      await E.postOnce(API + "/stocktakes/" + encodeURIComponent(stId) + "/items", body, {
        list: async function () { return (await getOne(stId)).items || []; },
        same: function (it) { return String(it.item_name) === name && String(it.dosage || "") === dosage && Number(it.qty_tablets) === body.qty_tablets; }
      });
      S.adding = { item_name: "", dosage: "", qty_tablets: "" }; S.addErr = "";
      var nm = S.mount && S.mount.querySelector('[data-fk="add-name"]'); if (nm) nm.value = ""; // keep() must not put it back
      ["add-dosage", "add-qty"].forEach(function (k) { var x = S.mount && S.mount.querySelector('[data-fk="' + k + '"]'); if (x) x.value = ""; });
      E.toast && E.toast("Item added", "success");
      S.addSaving = false;
      await loadOne(stId, true);
      focusSoon('[data-fk="add-name"]');
    } catch (x) {
      S.addSaving = false; S.addErr = failText(x); paint();
    }
  }

  async function create() {
    if (S.creating) return;
    S.creating = true; S.createErr = ""; paint();
    try {
      var r = await E.postOnce(API + "/stocktakes", {}, { list: getList, same: function () { return true; } });
      var id = r && r.stocktake_id;
      if (!id) { var l = await getList(); id = l[0] && l[0].id; } // the answer was lost but it arrived: it is the newest
      S.creating = false;
      if (!id) throw new Error("Create failed");
      E.toast && E.toast("Stock take started", "success");
      open(String(id));
    } catch (x) { S.creating = false; S.createErr = failText(x); paint(); }
  }

  function open(id) {
    S.openId = String(id); S.cur = null; S.rows = {}; S.adding = null; S.addErr = ""; S.editId = null; S.edit = null; S.closeErr = ""; S.curErr = "";
    loadOne(S.openId, true).then(function () { focusSoon(S.cur && S.cur.items.length ? "input.dst-cnt" : '[data-fk="add-name"]'); loadNotYet(); });
  }

  async function closeIt() {
    if (S.closing || !S.openId) return;
    keep();
    var id = S.openId; S.closing = true; S.closeErr = ""; paint();
    var ok = false;
    try {
      var r = await E.apiFetch(API + "/stocktakes/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ closed: 1 }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Close failed");
      ok = true;
    } catch (x) {
      S.closeErr = failText(x);
      if (x && x.network) { try { ok = !!(await getOne(id)).stocktake.closed_at; } catch (e) { ok = false; } }
    }
    S.closing = false;
    if (ok) { S.closeErr = ""; E.toast && E.toast("Stock take saved and closed", "success"); await loadOne(id, true); focusSoon('[data-fk="print"]'); }
    else paint();
  }

  // Same as the classic: the worker's printable page, fetched and opened in a new tab (one tab, not two).
  async function print() {
    if (!S.openId || S.printing) return;
    S.printing = true; paint();
    try {
      var resp = await E.apiFetch(API + "/stocktakes/" + encodeURIComponent(S.openId) + "/report/html", { method: "GET" });
      var html = resp && typeof resp.text === "string" ? resp.text : "";
      if (!html) throw new Error("Empty report");
      var url = URL.createObjectURL(new Blob([html], { type: "text/html" })), w = null;
      // The classic asks for "noopener", which makes window.open return null even when the tab opened, so its fallback
      // link opened the page a second time. Here the opener is cut by hand and the fallback runs only when blocked.
      try { w = window.open(url, "_blank"); if (w) w.opener = null; } catch (e) { w = null; }
      if (!w) { try { var a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove(); } catch (e2) {} }
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e3) {} }, 60000);
    } catch (x) { E.toast && E.toast("Could not prepare the print. " + String((x && x.network) ? "Can't reach the server." : (x && x.message) || ""), "error"); }
    S.printing = false; paint();
  }

  E.registerModule({
    id: ID, title: "Controlled drug stock takes", order: 6, icon: "℞", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.createErr = ""; S.editId = null; S.edit = null; css();
      if (S.openId && S.cur && S.cur.stocktake.closed_at) { S.openId = null; S.cur = null; S.rows = {}; } // a closed one is not reopened by itself
      if (S.openId) { paint(); return Promise.all([loadOne(S.openId, true), getList().then(function (l) { S.list = l; }).catch(function () {})]); } // back to the one still being counted
      paint(); return E.takeOpenForm(ID, S.mount, loadList(), { focus: "[data-act=new]" });
    },
    destroy: function () { keep(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf(ID) < 0) E.UI2_DESTINATIONS.push(ID);
  if (E.UI2_PARENT) E.UI2_PARENT[ID] = "registers";
  if (E.UI2_NATIVE) E.UI2_NATIVE.dda_stocktakes = ID;
})();