/* ============================================================
   EIKON — correct a register line in the new layout  (eikon.correct.js)
   Shared by the rebuilt registers. A line is never deleted here: it is corrected, by the pharmacist (an admin, or a
   staff sign-in marked Pharmacist — John, 2026-11-11, roles Q3) only, with a reason, and the line stays where it is.
   The "Corrected … by … : reason" marks come from the audit, which only an admin reads.

   Each screen keeps its own list and calls:
     E.correct.button(key, row, what)  "Correct" on the line (nothing for staff): what = the line in words, for screen readers
     E.correct.panel(key, row, cfg)    the correction form under that line, when it is open
     E.correct.mark(key, row)          "Corrected 3 Nov by Maria: <reason>" (from the audit) or ""
     E.correct.wire(root, key, cfg)    after each paint (the buttons and the form)
     E.correct.loadMarks(key, cfg, from)  after a load: which lines were changed, by whom and why (admin reads the audit)
     E.correct.reset(key)              when the screen opens

   cfg = {
     entity:  audit entity_type (e.g. "dda_sales_entries"), action: the update's audit action (e.g. "DDA_SALES_ENTRY_UPDATE"),
     fields:  [{ k, label, type: "text"|"date"|"time"|"int"|"num"|"money"|"select"|"check", opts: [[value, label]], req, hint }]
              the fields that may be corrected (the rest of the record is sent as it is on the server),
     reread:  async (row) => the line as the server has it now, or null when it is gone,
     put:     (row) => the update path, body: (rec) => the screen's classic update body built from the whole record,
     reasonIn:(body) => the object correction_reason goes on (default: the body),
     markIf:  (auditEntry) => true when that audit entry is a change (an action shared with recording, e.g. an upsert),
     check:   (rec) => "" or what is wrong, in words ("Write the patient's name."),
     pass:    { label, header } when the update needs a password (locum receipts), never kept,
     paint:   () => redraw the screen now, idle: () => redraw once no form has focus (E.whenFormIdle),
     done:    () => read the list again after a correction.
   }
   The flow: open re-reads the line and fills the form with the server's copy. Save needs a reason and a change; it
   reads the line again and, if anyone changed it since the form was filled, saves nothing and shows both versions.
   Otherwise it sends the WHOLE record as re-read with only the corrected fields different (most register updates
   replace every column: UPDATE-AUDIT.md), plus correction_reason, which the worker writes into the update's audit
   entry next to the before/after copies (a worker without it ignores the field: the audit still has before/after).
   A lost answer re-reads the line: it counts as saved only when the line now holds what was sent.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var ST = {};
  function st(key) { return ST[key] || (ST[key] = { open: null, orig: null, vals: {}, reason: "", pass: "", err: "", saving: false, loading: false, stale: null, marks: {}, focus: null, caret: null }); }
  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function isAdmin() { var u = E.state && E.state.user; return !!(u && u.role === "admin"); }
  // Who may correct: an admin, or a pharmacist (a staff sign-in marked Pharmacist; GET /team/me, read once per sign-in).
  // The register PUT routes take a staff sign-in as they always have; the reason goes to the audit either way.
  function canFix() { var u = E.state && E.state.user, r = E.rights; return isAdmin() || !!(u && u.role === "staff" && r && r.role === "staff" && r.is_pharmacist === true); }
  function str(v) { return v == null ? "" : String(v).trim(); }
  function me() { var u = (E.state && E.state.user) || {}; return String(u.full_name || u.email || "").trim(); }
  // A value as the form shows it, and as it is compared: numbers as numbers, ticks as 0/1, money to the cent.
  function shown(f, v) {
    if (f.type === "check") return v === true || Number(v) === 1 || String(v).toLowerCase() === "true" ? "1" : "0";
    if (f.type === "money") { var n = Number(String(v == null ? "" : v).replace(",", ".")); return v === "" || v == null || !isFinite(n) ? str(v) : n.toFixed(2); }
    if (f.type === "time") return str(v).slice(0, 5);
    return str(v);
  }
  function same(f, a, b) {
    var x = shown(f, a), y = shown(f, b);
    if (f.type === "int" || f.type === "num" || f.type === "money") { var nx = Number(x), ny = Number(y); if (x !== "" && y !== "" && isFinite(nx) && isFinite(ny)) return nx === ny; }
    return x === y;
  }
  // The value the server gets: the type the classic screen sends.
  function cast(f, v) {
    var s = str(v);
    if (f.type === "int") return /^\d+$/.test(s) ? Number(s) : s;
    if (f.type === "num") return s !== "" && isFinite(Number(s.replace(",", "."))) ? Number(s.replace(",", ".")) : s;
    if (f.type === "money") { var n = Number(s.replace(",", ".")); return s !== "" && isFinite(n) ? n.toFixed(2) : s; }
    if (f.type === "check") return s === "1" ? 1 : 0;
    return s;
  }
  function word(f, v) { var s = shown(f, v); if (f.type === "check") return s === "1" ? "Yes" : "No"; if (f.type === "select") { var o = (f.opts || []).filter(function (x) { return String(x[0]) === s; })[0]; if (o) return o[1]; } return s === "" ? "(empty)" : s; }
  function when(at) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(at || "")); return m ? Number(m[3]) + " " + SHORT[Number(m[2]) - 1] + (m[1] !== String(new Date().getFullYear()) ? " " + m[1] : "") : ""; }

  function css() {
    if (document.getElementById("eikon-correct-css")) return;
    var s = document.createElement("style");
    s.id = "eikon-correct-css";
    s.textContent =
      ".ecr-btn{font:inherit;font-size:13px;font-weight:600;min-height:32px;padding:0 12px;border-radius:16px;border:1px solid var(--border);background:transparent;color:var(--accent);cursor:pointer;white-space:nowrap;flex:0 0 auto}" +
      ".ecr-btn[aria-expanded=true]{background:rgba(118,118,128,.12);color:var(--text)}" +
      ".ecr-btn:focus-visible,.ecr button:focus-visible,.ecr input:focus-visible,.ecr select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".ecr-mark{display:block;font-size:12px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}.ecr-mark b{font-weight:600;color:var(--text)}" +
      ".ecr{display:block;margin:4px 12px 10px;background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:4px 0}" +
      ".ecr-h{padding:10px 14px 6px;font-size:15px;font-weight:700}.ecr-h span{display:block;font-size:12.5px;font-weight:400;color:var(--muted);margin-top:2px}" +
      ".ecr label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}" +
      ".ecr label>span{flex:0 0 112px;font-size:14.5px}.ecr label>span small{display:block;font-size:11.5px;color:var(--muted)}" +
      ".ecr input:not([type=checkbox]),.ecr select{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".ecr label input:focus-visible,.ecr label select:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:6px}.ecr label:focus-within{background:rgba(118,118,128,.06)}" +
      ".ecr input[type=checkbox]{width:20px;height:20px;accent-color:var(--accent);margin-left:auto}" +
      ".ecr label.ecr-why{background:rgba(201,138,18,.07)}.ecr label.ecr-why>span{font-weight:600}" +
      ".ecr label.ch>span::after{content:' · changed';color:var(--accent);font-size:11.5px;font-weight:600}" +
      ".ecr-err{color:var(--danger);font-size:13px;padding:6px 14px}" +
      ".ecr-stale{margin:6px 14px;padding:10px 12px;border-radius:10px;background:rgba(201,138,18,.12);font-size:13.5px}" +
      ".ecr-stale table{width:100%;border-collapse:collapse;margin-top:6px;font-size:13px}.ecr-stale th,.ecr-stale td{text-align:left;padding:3px 6px 3px 0;vertical-align:top;overflow-wrap:anywhere}.ecr-stale th{color:var(--muted);font-weight:600}" +
      ".ecr-acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end;flex-wrap:wrap;border-top:.5px solid var(--border)}" +
      ".ecr-acts button{font:inherit;font-size:14px;font-weight:600;min-height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".ecr-acts button.p{background:var(--accent);border-color:var(--accent);color:#fff}.ecr-acts button:disabled{opacity:.55;cursor:default}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .ecr-acts button.p{color:#00160E}}" +
      "@media (max-width:600px){.ecr{margin:4px 0 10px}.ecr label>span{flex-basis:96px}}";
    document.head.appendChild(s);
  }

  var C = E.correct = {};
  C.can = canFix;
  C.reset = function (key) { var m = ST[key] && ST[key].marks; ST[key] = null; st(key).marks = m || {}; };
  C.isOpen = function (key) { return !!(ST[key] && ST[key].open != null); };
  C.openId = function (key) { return ST[key] ? ST[key].open : null; };

  // The screen's footer line: corrections happen here, by the pharmacist; deleting is in the classic screen.
  // del: what the pharmacist deletes there, with its verb ("Deleting a payment is"); a line by default.
  C.foot = function (extra, del) {
    return '<p class="ecr-foot" style="font-size:12.5px;color:var(--muted);margin-top:12px">' + (isAdmin()
      ? "A wrong line is put right with Correct, saying what was wrong; the audit keeps what it said before. " + (del || "Deleting a line is") + ' in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.'
      : canFix() ? "A wrong line is put right with Correct, saying what was wrong; the audit keeps what it said before."
      : "A wrong line is corrected by the pharmacist (Correct, with the reason).") + (extra ? " " + extra : "") + "</p>";
  };

  C.button = function (key, row, what) {
    if (!canFix() || !row || row.id == null) return "";
    css();
    var open = String(st(key).open) === String(row.id);
    return '<button type="button" class="ecr-btn" data-ecr="open" data-ecr-key="' + esc(key) + '" data-ecr-id="' + esc(row.id) + '" aria-expanded="' + open + '" aria-label="' + esc("Correct " + (what || "this line")) + '">Correct</button>';
  };

  C.mark = function (key, row) {
    var m = row && st(key).marks[String(row.id)];
    if (!m) return "";
    css();
    return '<span class="ecr-mark">' + (m.reason ? "<b>Corrected</b> " : "Corrected ") + esc(when(m.at)) + (m.by ? " by " + esc(m.by) : "") + (m.reason ? ": " + esc(m.reason) : "") + "</span>";
  };

  C.panel = function (key, row, cfg) {
    var s = st(key);
    if (!row || String(s.open) !== String(row.id)) return "";
    css();
    if (s.loading || !s.orig) return '<div class="ecr" role="status">Reading the line again…</div>';
    var o = s.orig, v = s.vals;
    var h = '<form class="ecr" data-ecr-form="' + esc(key) + '" autocomplete="off" aria-label="Correct this line">' +
      '<div class="ecr-h">Correct this line<span>It stays in the register. The audit keeps what it said before, who corrected it and why.</span></div>';
    cfg.fields.forEach(function (f) {
      var val = v[f.k] != null ? v[f.k] : shown(f, o[f.k]), ch = !same(f, val, o[f.k]) ? " ch" : "", nm = "ecr_" + f.k, inp;
      if (f.type === "select") inp = '<select name="' + nm + '">' + (f.opts || []).map(function (x) { return '<option value="' + esc(x[0]) + '"' + (String(x[0]) === String(val) ? " selected" : "") + ">" + esc(x[1]) + "</option>"; }).join("") + "</select>";
      else if (f.type === "check") inp = '<input type="checkbox" name="' + nm + '"' + (val === "1" ? " checked" : "") + ">";
      else inp = '<input name="' + nm + '" value="' + esc(val) + '"' + (f.type === "date" ? ' type="date"' : f.type === "time" ? ' type="time"' : (f.type === "int" ? ' inputmode="numeric"' : f.type === "num" || f.type === "money" ? ' inputmode="decimal"' : "")) + (f.ph ? ' placeholder="' + esc(f.ph) + '"' : "") + ">";
      h += '<label class="' + ch.trim() + '"><span>' + esc(f.label) + (f.hint ? "<small>" + esc(f.hint) + "</small>" : "") + "</span>" + inp + "</label>";
    });
    if (cfg.pass) h += '<label><span>' + esc(cfg.pass.label || "Edit password") + '</span><input type="password" name="ecr__pass" value="' + esc(s.pass) + '" autocomplete="off"></label>';
    h += '<label class="ecr-why"><span>What was wrong?</span><input name="ecr__reason" value="' + esc(s.reason) + '" placeholder="' + esc(cfg.reasonPh || "e.g. Quantity typed as 20, the prescription says 10") + '" maxlength="500" aria-required="true"></label>';
    if (s.stale) {
      h += '<div class="ecr-stale" role="alert"><b>Someone else changed this line while you were correcting it. Nothing was saved.</b> Their version is in the form now; make your correction again if it is still needed.' +
        '<table><thead><tr><th scope="col"></th><th scope="col">Now in the register</th><th scope="col">What you typed</th></tr></thead><tbody>' +
        s.stale.map(function (d) { return "<tr><th scope=\"row\">" + esc(d.label) + "</th><td>" + esc(d.server) + "</td><td>" + esc(d.mine) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    }
    if (s.err) h += '<div class="ecr-err" role="alert">' + esc(s.err) + "</div>";
    h += '<div class="ecr-acts"><button type="button" data-ecr="cancel">Cancel</button><button type="submit" class="p"' + (s.saving ? " disabled" : "") + ">" + (s.saving ? "Saving…" : "Save correction") + "</button></div></form>";
    return h;
  };

  function collect(key, root, cfg) {
    var s = st(key), f = root && root.querySelector('[data-ecr-form="' + key + '"]');
    if (!f) return;
    cfg.fields.forEach(function (x) { var el = f.querySelector('[name="ecr_' + x.k + '"]'); if (el) s.vals[x.k] = x.type === "check" ? (el.checked ? "1" : "0") : String(el.value || ""); });
    var r = f.querySelector('[name="ecr__reason"]'); if (r) s.reason = String(r.value || "");
    var p = f.querySelector('[name="ecr__pass"]'); if (p) s.pass = String(p.value || "");
  }

  C.wire = function (root, key, cfg) {
    if (!root) return;
    var s = st(key);
    root.querySelectorAll('[data-ecr="open"][data-ecr-key="' + key + '"]').forEach(function (b) {
      b.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); open(key, cfg, b.getAttribute("data-ecr-id"), root); });
    });
    var f = root.querySelector('[data-ecr-form="' + key + '"]');
    if (!f) return;
    f.addEventListener("input", function () { collect(key, root, cfg); });
    f.addEventListener("change", function () { collect(key, root, cfg); });
    f.addEventListener("focusin", function (ev) { var n = ev.target && ev.target.name; if (n) s.focus = n; });
    f.addEventListener("focusout", function () { setTimeout(function () { if (document.body.contains(f) && !f.contains(document.activeElement)) s.focus = null; }, 0); }); // left the form (not a redraw)
    f.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); close(key, cfg, true); } });
    f.addEventListener("submit", function (ev) { ev.preventDefault(); collect(key, root, cfg); save(key, cfg); });
    var c = f.querySelector('[data-ecr="cancel"]'); if (c) c.addEventListener("click", function () { close(key, cfg, true); });
    // A redraw while someone types puts them back where they were.
    if (s.focus && (!document.activeElement || document.activeElement === document.body)) {
      var el = f.querySelector('[name="' + s.focus + '"]');
      if (el) { el.focus(); if (s.caret != null && el.setSelectionRange && /^(text|search|password|)$/.test(el.type || "")) { try { el.setSelectionRange(s.caret, s.caret); } catch (e) {} } }
    }
    f.addEventListener("keyup", function (ev) { var t = ev.target; if (t && typeof t.selectionStart === "number") s.caret = t.selectionStart; });
  };

  function close(key, cfg, back) {
    var s = st(key), id = s.open;
    s.open = null; s.orig = null; s.vals = {}; s.reason = ""; s.pass = ""; s.err = ""; s.stale = null; s.saving = false; s.focus = null; s.caret = null;
    cfg.paint();
    if (back && id != null) { var b = document.querySelector('[data-ecr="open"][data-ecr-key="' + key + '"][data-ecr-id="' + id + '"]'); if (b) b.focus(); }
  }

  async function open(key, cfg, id, root) {
    var s = st(key);
    if (String(s.open) === String(id)) return close(key, cfg, true);
    if (!canFix()) return;
    var row = (cfg.rows ? cfg.rows() : []).filter(function (r) { return String(r.id) === String(id); })[0];
    if (!row) return;
    s.open = row.id; s.orig = null; s.vals = {}; s.reason = ""; s.pass = ""; s.err = ""; s.stale = null; s.saving = false; s.loading = true; s.focus = null;
    cfg.paint();
    var fresh = null;
    try { fresh = await cfg.reread(row); } catch (e) { fresh = null; s.err = e && e.network ? "Can't reach the server to read this line again. The form shows it as listed." : ""; }
    if (String(s.open) !== String(row.id)) return; // closed or another line opened meanwhile
    s.loading = false;
    if (!fresh && !s.err) { s.open = null; E.toast && E.toast("This line is no longer in the register.", "error"); cfg.done(); return; }
    s.orig = fresh || row;
    cfg.fields.forEach(function (f) { s.vals[f.k] = shown(f, s.orig[f.k]); });
    s.focus = "ecr_" + cfg.fields[0].k;
    cfg.paint();
  }

  async function save(key, cfg) {
    var s = st(key);
    if (s.saving || s.open == null || !s.orig) return;
    if (!canFix()) { s.err = "Only the pharmacist can correct a register line. Nothing was saved."; return cfg.paint(); }
    var orig = s.orig, reason = str(s.reason).replace(/\s+/g, " ");
    var changed = cfg.fields.filter(function (f) { return !same(f, s.vals[f.k], orig[f.k]); });
    var rec0 = Object.assign({}, orig); changed.forEach(function (f) { rec0[f.k] = cast(f, s.vals[f.k]); });
    s.err = ""; s.stale = null;
    var req = cfg.fields.filter(function (f) { return f.req && !str(s.vals[f.k]); })[0];
    if (!changed.length) s.err = "Nothing was changed. Change what was wrong, or press Cancel.";
    else if (req) s.err = "Write " + (req.what || req.label.toLowerCase()) + ". Nothing was saved.";
    else if (cfg.check && cfg.check(rec0)) s.err = cfg.check(rec0) + " Nothing was saved.";
    else if (!reason) { s.err = "Write what was wrong, for the audit. Nothing was saved."; s.focus = "ecr__reason"; }
    else if (cfg.pass && !str(s.pass)) { s.err = "Type the edit password. Nothing was saved."; s.focus = "ecr__pass"; }
    if (s.err) return cfg.paint();
    s.saving = true; cfg.paint();
    var body = null, id = s.open;
    try {
      var fresh = await cfg.reread(orig);
      if (!fresh) throw new Error("This line is no longer in the register (removed elsewhere?)");
      var moved = cfg.fields.filter(function (f) { return !same(f, fresh[f.k], orig[f.k]); });
      if (!moved.length && orig.updated_at && fresh.updated_at && String(orig.updated_at) !== String(fresh.updated_at)) moved = changed; // changed and changed back, or a column not on the form
      if (moved.length) {
        s.stale = cfg.fields.filter(function (f) { return !same(f, fresh[f.k], orig[f.k]) || !same(f, s.vals[f.k], orig[f.k]); })
          .map(function (f) { return { label: f.label, server: word(f, fresh[f.k]), mine: word(f, s.vals[f.k]) }; });
        s.orig = fresh; cfg.fields.forEach(function (f) { s.vals[f.k] = shown(f, fresh[f.k]); });
        s.saving = false; return cfg.paint();
      }
      var rec = Object.assign({}, fresh); changed.forEach(function (f) { rec[f.k] = cast(f, s.vals[f.k]); });
      body = cfg.body(rec);
      (cfg.reasonIn ? cfg.reasonIn(body) : body).correction_reason = reason;
      var headers = cfg.pass ? (function () { var h = {}; h[cfg.pass.header] = str(s.pass); return h; })() : undefined;
      var r = await E.apiFetch(cfg.put(fresh), { method: cfg.method || "PUT", headers: headers, body: JSON.stringify(body) });
      if (!r || r.ok === false) throw new Error((r && r.error) || "Save failed");
      ok();
    } catch (x) {
      if (x && x.network && body && await landed()) ok();
      else {
        s.err = x && x.status === 403 && cfg.pass ? "The edit password was not accepted. Nothing was saved." : E.saveFailText(x);
        s.saving = false; return cfg.paint();
      }
    }
    async function landed() { // the answer was lost: saved only when the line now holds what was sent
      try { var now = await cfg.reread(orig); return !!now && changed.every(function (f) { return same(f, now[f.k], s.vals[f.k]); }); } catch (e) { return false; }
    }
    function ok() {
      s.marks[String(id)] = { at: new Date().toISOString(), by: me(), reason: reason };
      E.toast && E.toast("Corrected. The audit keeps the line as it was.", "success");
      var back = id;
      s.open = null; s.orig = null; s.vals = {}; s.reason = ""; s.pass = ""; s.err = ""; s.stale = null; s.saving = false; s.focus = null;
      Promise.resolve(cfg.done()).then(function () { var b = document.querySelector('[data-ecr="open"][data-ecr-key="' + key + '"][data-ecr-id="' + back + '"]'); if (b && (!document.activeElement || document.activeElement === document.body)) b.focus(); });
    }
  }

  // Which lines were changed after they were recorded: the newest update of each, from the audit (the pharmacist can
  // read it; staff cannot, and see no mark). from: the first day the lines could have been changed (their month).
  C.loadMarks = async function (key, cfg, from) {
    if (!isAdmin() || !cfg.entity) return;
    var s = st(key);
    try {
      var q = "/audit/log?module=" + encodeURIComponent(cfg.entity) + (cfg.action ? "&action=" + encodeURIComponent(cfg.action) : "") + (from ? "&from=" + encodeURIComponent(from) : "") + "&limit=1000";
      var r = await E.apiFetch(q, { method: "GET" });
      if (!r || !r.ok) return;
      var map = {};
      (r.entries || []).forEach(function (a) { // newest first
        var id = String(a.entity_id || ""); if (!id || map[id] || (cfg.markIf && !cfg.markIf(a))) return;
        map[id] = { at: String(a.created_at || ""), by: String(a.user_name || ""), reason: String((a.details && a.details.correction_reason) || "") };
      });
      Object.keys(s.marks).forEach(function (id) { if (!map[id]) map[id] = s.marks[id]; }); // one just saved, before the audit is read back
      s.marks = map;
      (cfg.idle || cfg.paint)(); // drawn once nobody is typing in a form
    } catch (e) {}
  };
})();
