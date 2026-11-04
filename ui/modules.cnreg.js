/* Credit notes, new layout: money customers have with the pharmacy. Find a customer (name, phone or receipt), see what
   is left on each note, use some or all of it, record a new note. Using a note first reads it again from the server and
   never takes more than is left (the server itself does not check). Expired notes with money left are listed apart.
   Correct (the pharmacist only, eikon.correct.js) on each note listed with money left: read again, the classic edit's
   fields and body (no end date = no expiry), a required reason, the whole note sent (the update replaces every field).
   A note is never deleted here. Each note lists its uses; the pharmacist can undo a use (the classic removal: the same
   DELETE, after one plain-words question; the worker's audit keeps the use). A search also finds notes used up, so a
   use that took the whole note can be undone.
   q5-10a: each note prints on the classic screen's one-note page (printCreditNote in modules.creditnotes.js, the same
   HTML, through E.openPrint), and carries its notes as the classic keeps them: listed under the note, "Add a note"
   sends the classic POST …/notes { text }, and the pharmacist can remove one (the classic DELETE, after one plain-words
   question; the worker's audit keeps it). Deleting a credit note stays in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", q: "", using: null, draft: {}, adding: null, saving: false, err: "", undo: null, noting: null, rmNote: null };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  // The year is left out when it is this year (3 Nov), kept otherwise (4 Mar 2027): rows stay on fewer lines on a phone.
  function dm(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + (Number(p[0]) === new Date().getFullYear() ? "" : " " + p[0]) : ""; }
  function eur(n) { return "€" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
  function money(raw) { var s = String(raw || "").replace(/[€\s]/g, "").replace(",", "."); return /^\d+(\.\d{1,2})?$/.test(s) && Number(s) > 0 ? Number(s) : null; }
  function left(cn) { var used = (cn.purchase_entries || []).reduce(function (t, p) { return t + (Number(p.amount) || 0); }, 0); return Math.round(((Number(cn.amount) || 0) - used) * 100) / 100; }
  function expired(cn) { return !cn.no_expiry && cn.expiry_date && cn.expiry_date < today(); }
  function low(s) { return String(s || "").toLowerCase(); }

  function css() {
    if (document.getElementById("eikon-cnreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-cnreg-css";
    st.textContent =
      ".cnr{max-width:880px;margin:0 auto}" +
      ".cnr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 12px 0 0;min-height:44px;margin:-8px 0 2px;cursor:pointer}" +
      ".cnr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".cnr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.cnr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".cnr-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".cnr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.cnr-btn:disabled{opacity:.55;cursor:default}" +
      ".cnr-q{width:100%;box-sizing:border-box;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0;margin-top:16px}" +
      ".cnr-sum{font-size:13.5px;color:var(--muted);margin:10px 2px 0}.cnr-sum b{color:var(--text);font-variant-numeric:tabular-nums}" +
      ".cnr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.cnr-lab b{color:var(--text)}" +
      ".cnr-card{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:10px}" +
      ".cnr-card .h{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.cnr-card .h b{font-size:15.5px;font-weight:600}.cnr-card .h em{font-style:normal;font-size:19px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ok)}" +
      ".cnr-card.old .h em{color:var(--muted)}.cnr-card .s{font-size:12.5px;color:var(--muted);margin-top:3px}.cnr-card .s a{color:var(--accent);text-decoration:none}" +
      ".cnr-card .a{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}" +
      ".cnr-in{margin-top:10px;border-radius:10px;background:rgba(118,118,128,.07)}" +
      ".cnr-in label,.cnr-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.cnr-in label:first-child,.cnr-form label:first-child{border-top:0}" +
      ".cnr-in label>span,.cnr-form label>span{flex:0 0 96px;font-size:15px}.cnr-in input,.cnr-form input:not([type=checkbox]){flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".cnr-in .acts,.cnr-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end;align-items:center}.cnr-in .acts .all{margin-right:auto;border:0;background:none;color:var(--accent);font:inherit;font-size:14px;font-weight:600;cursor:pointer;padding:0}" +
      ".cnr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".cnr-err{color:var(--danger);font-size:13.5px;padding:4px 14px}.cnr [aria-invalid=true]{box-shadow:inset 0 -2px 0 var(--danger)}" +
      ".cnr-uses{list-style:none;margin:8px 0 0;padding:0;border-top:.5px solid var(--border)}.cnr-uses li{display:flex;align-items:center;gap:10px;min-height:44px;border-bottom:.5px solid var(--border);font-size:13.5px}" +
      ".cnr-uses li span{flex:1;min-width:0;font-variant-numeric:tabular-nums}.cnr-uses li:last-child{border-bottom:0}" +
      ".cnr-undo{font:inherit;font-size:13px;font-weight:600;min-height:36px;padding:0 12px;border-radius:18px;border:1px solid var(--border);background:transparent;color:var(--accent);cursor:pointer}" +
      ".cnr-ask{margin:6px 0 4px;padding:12px 14px;border-radius:12px;background:var(--warn-soft,rgba(201,138,18,.16));font-size:14px;line-height:1.45}.cnr-ask .acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px}" +
      ".cnr-ask .cnr-err{padding:6px 0 0}.cnr button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".cnr-card .a{flex-wrap:wrap;justify-content:space-between;align-items:center}.cnr-card .a>span{display:flex;gap:8px;flex-wrap:wrap}.cnr-card .a>span.r{margin-left:auto}" +
      ".cnr-lnk{font:inherit;font-size:14px;font-weight:600;min-height:44px;padding:0 10px;border:0;border-radius:10px;background:none;color:var(--accent);cursor:pointer}.cnr-lnk:first-child{margin-left:-10px}" +
      ".cnr-notes li span small{display:block;color:var(--muted);font-size:12px}.cnr-notes li span{white-space:pre-wrap;overflow-wrap:anywhere;padding:6px 0}" +
      ".cnr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.cnr{padding:4px 16px 0}.cnr h1{font-size:32px}.cnr-btn{height:44px;border-radius:22px;padding:0 18px}.cnr-q{height:44px}.cnr-in .acts .all{min-height:44px}}" +
      // q5-8: every target at least 44 px tall on a phone (the phone number, Undo, Correct).
      "@media (max-width:600px){.cnr-card .s a{display:inline-flex;align-items:center;min-height:44px;vertical-align:middle}.cnr-undo,.cnr .ecr-btn{min-height:44px;border-radius:22px;padding:0 16px}}";
    document.head.appendChild(st);
  }

  var FIX = { reasonPh: "e.g. Amount typed as 25.50, the receipt says 20", entity: "credit_notes", action: "CREDITNOTE_UPDATE",
    fields: [{ k: "client_name", label: "Name", req: true, what: "the name" }, { k: "client_surname", label: "Surname", req: true, what: "the surname" },
      { k: "telephone", label: "Phone", req: true, what: "the phone" }, { k: "email", label: "Email" }, { k: "amount", label: "Amount €", type: "num", req: true, what: "the amount" },
      { k: "receipt_number", label: "Receipt no." }, { k: "issue_date", label: "Issued", type: "date", req: true, what: "the date it was issued" },
      { k: "expiry_date", label: "Expires", type: "date", hint: "Empty: no end date" }],
    rows: function () { return S.entries; },
    reread: async function (row) { return (await fetchAll()).filter(function (cn) { return String(cn.id) === String(row.id); })[0] || null; },
    put: function (row) { return "/creditnotes/entries/" + encodeURIComponent(String(row.id)); },
    body: function (r) { // the classic readMainForm: its keys and its rule (an empty expiry is no end date)
      var exp = String(r.expiry_date == null ? "" : r.expiry_date).trim();
      return { issue_date: String(r.issue_date || "").trim(), client_name: String(r.client_name || "").trim(), client_surname: String(r.client_surname || "").trim(), telephone: String(r.telephone || "").trim(),
        email: String(r.email == null ? "" : r.email).trim(), receipt_number: String(r.receipt_number == null ? "" : r.receipt_number).trim(), amount: String(r.amount == null ? "" : r.amount).trim(),
        expiry_date: exp, no_expiry: exp ? 0 : 1 };
    },
    check: function (r) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.issue_date))) return "Choose the date it was issued.";
      if (!(parseFloat(r.amount) > 0)) return "The amount should be more than 0, e.g. 20.00.";
      if (String(r.expiry_date || "") && !/^\d{4}-\d{2}-\d{2}$/.test(String(r.expiry_date))) return "Choose the expiry date, or leave it empty.";
      return "";
    },
    paint: function () { paint(true); }, idle: function () { E.whenFormIdle(S.mount, function () { paint(); }); }, done: function () { return load(); } };
  async function fetchAll() {
    var r = await E.apiFetch("/creditnotes/list", { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not load credit notes");
    return r.entries || [];
  }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try { S.entries = await fetchAll(); E.correct.loadMarks("cnreg", FIX, ""); }
    catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load credit notes"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  // A use as the server stamps it (UTC, SQLite): its day in Malta.
  function useDay(u) { var t = Date.parse(String(u.timestamp || "").replace(" ", "T") + (/[zZ+]/.test(String(u.timestamp || "").slice(10)) ? "" : "Z")); return isFinite(t) && E.maltaYmd ? dm(E.maltaYmd(new Date(t))) : ""; }
  function usesHtml(cn) {
    var uses = cn.purchase_entries || []; if (!uses.length) return "";
    var can = E.correct && E.correct.can();
    return '<ul class="cnr-uses" aria-label="' + esc("Uses of the note for " + cn.client_name + " " + cn.client_surname) + '">' + uses.map(function (u) {
      var day = useDay(u), what = "Used " + eur(u.amount) + (day ? " on " + day : "") + (u.receipt_number ? " · receipt " + u.receipt_number : "");
      var h = "<li><span>" + esc(what) + "</span>" + (can ? '<button type="button" class="cnr-undo" data-act="undo" data-id="' + esc(cn.id) + '" data-pid="' + esc(u.id) + '" aria-label="' + esc("Undo: " + what) + '">Undo</button>' : "") + "</li>";
      var q = S.undo;
      if (q && String(q.cn) === String(cn.id) && String(q.pid) === String(u.id)) {
        h += '<li class="cnr-ask"><div role="group" aria-label="Undo this use"><b>Undo the use of ' + esc(eur(u.amount)) + (day ? " on " + esc(day) : "") + "?</b> " + esc(eur(u.amount)) + " goes back on the note, leaving " + esc(eur(left(cn) + (Number(u.amount) || 0))) + ". The audit keeps the use." +
          (q.err ? '<div class="cnr-err" role="alert">' + esc(q.err) + "</div>" : "") +
          '<div class="acts"><button type="button" class="cnr-btn" data-act="undo-no">Keep it</button><button type="button" class="cnr-btn p" data-act="undo-yes"' + (q.busy ? " disabled" : "") + ">" + (q.busy ? "Undoing…" : "Undo the use") + "</button></div></div></li>";
      }
      return h;
    }).join("") + "</ul>";
  }
  // A note's own notes, as the classic lists them (oldest first), with the time in Malta.
  function stamp(ts) { var t = Date.parse(String(ts || "").replace(" ", "T") + (/[zZ+]/.test(String(ts || "").slice(10)) ? "" : "Z")); return isFinite(t) && E.maltaYmd ? dm(E.maltaYmd(new Date(t))) + " " + (E.maltaHm ? E.maltaHm(new Date(t)) : "") : ""; }
  function notesHtml(cn) {
    var ns = cn.notes || [], can = E.correct && E.correct.can(), who = cn.client_name + " " + cn.client_surname, h = "";
    if (ns.length) h += '<ul class="cnr-uses cnr-notes" aria-label="' + esc("Notes on the credit note for " + who) + '">' + ns.map(function (n) {
      var at = stamp(n.timestamp);
      var li = "<li><span>" + esc(n.text) + (at ? "<small>Note · " + esc(at) + "</small>" : "") + "</span>" + (can ? '<button type="button" class="cnr-undo" data-act="rmnote" data-id="' + esc(cn.id) + '" data-nid="' + esc(n.id) + '" aria-label="' + esc("Remove the note: " + n.text) + '">Remove</button>' : "") + "</li>";
      var q = S.rmNote;
      if (q && String(q.cn) === String(cn.id) && String(q.nid) === String(n.id)) li += '<li class="cnr-ask"><div role="group" aria-label="Remove this note"><b>Remove this note?</b> “' + esc(n.text) + "” goes from the credit note. The audit keeps it." +
        (q.err ? '<div class="cnr-err" role="alert">' + esc(q.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="cnr-btn" data-act="rmnote-no">Keep it</button><button type="button" class="cnr-btn p" data-act="rmnote-yes"' + (q.busy ? " disabled" : "") + ">" + (q.busy ? "Removing…" : "Remove the note") + "</button></div></div></li>";
      return li;
    }).join("") + "</ul>";
    var o = S.noting;
    if (o && String(o.cn) === String(cn.id)) h += '<form class="cnr-in" id="cnr-note" autocomplete="off"><label><span>Note</span><input name="note_text" value="' + esc(o.text || "") + '" placeholder="e.g. Called, will come on Friday"></label>' +
      (o.err ? '<div class="cnr-err" id="cnr-nerr" role="alert">' + esc(o.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="cnr-btn" data-act="note-cancel">Cancel</button><button type="submit" class="cnr-btn p"' + (o.busy ? " disabled" : "") + ">" + (o.busy ? "Saving…" : "Save note") + "</button></div></form>";
    return h;
  }

  // ---- the classic one-note print (modules.creditnotes.js printCreditNote, normalizeRow and its helpers), unchanged,
  // so the page is the classic one character for character.
  function cYmd(d) { if (!(d instanceof Date)) d = new Date(d); if (isNaN(d.getTime())) return ""; return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function cDmy(s) { var x = String(s || "").trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return x || "—"; return x.slice(8, 10) + "/" + x.slice(5, 7) + "/" + x.slice(0, 4); }
  function cDateTime(s) { if (!s) return "—"; try { var d = new Date(s); if (isNaN(d.getTime())) return String(s); return cDmy(cYmd(d)) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); } catch (e) { return String(s); } }
  function cEuro(v) { var n = parseFloat(v); if (isNaN(n)) return "€0.00"; return "€" + n.toFixed(2); }
  function safe(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function classicRow(r) {
    var cn = { id: r.id, issue_date: String(r.issue_date || ""), client_name: String(r.client_name || ""), client_surname: String(r.client_surname || ""), telephone: String(r.telephone || ""),
      email: String(r.email || ""), receipt_number: String(r.receipt_number || ""), amount: parseFloat(r.amount) || 0, expiry_date: String(r.expiry_date || ""), no_expiry: !!(r.no_expiry || r.no_expiry === 1),
      notes: Array.isArray(r.notes) ? r.notes : (r.notes ? JSON.parse(r.notes) : []), purchase_entries: Array.isArray(r.purchase_entries) ? r.purchase_entries : (r.purchase_entries ? JSON.parse(r.purchase_entries) : []) };
    var used = 0; cn.purchase_entries.forEach(function (p) { used += parseFloat(p.amount) || 0; });
    cn.remaining = cn.amount - used;
    cn.is_open = cn.remaining > 0 && (cn.no_expiry || !cn.expiry_date || (function () { var exp = new Date(cn.expiry_date); exp.setHours(23, 59, 59, 999); return !(exp < new Date()); })());
    return cn;
  }
  function printHtml(cn) {
    var isOpen = cn.is_open, remaining = cn.remaining, entries = cn.purchase_entries, notes = cn.notes, i;
    var entriesHtml = "";
    if (entries.length) { for (i = 0; i < entries.length; i++) { var e = entries[i]; entriesHtml += "<tr><td>" + safe(cDateTime(e.timestamp)) + "</td><td>" + safe(e.receipt_number || "—") + "</td><td style='text-align:right'>" + safe(cEuro(e.amount)) + "</td></tr>"; } }
    else entriesHtml = "<tr><td colspan='3' style='opacity:.6;font-style:italic'>No purchase entries yet.</td></tr>";
    var nHtml = "";
    for (i = 0; i < notes.length; i++) { var n = notes[i]; nHtml += "<div style='border-bottom:1px solid #eee;padding:6px 0;font-size:12px'><span style='opacity:.6'>" + safe(cDateTime(n.timestamp)) + "</span> — " + safe(n.text) + "</div>"; }
    var expiry = cn.no_expiry ? "Does not expire" : (cn.expiry_date ? cDmy(cn.expiry_date) : "—");
    var status = isOpen ? "OPEN" : "CLOSED", statusColor = isOpen ? "#067647" : "#b42318";
    return "<!doctype html><html><head><meta charset='utf-8'/><title>Credit Note #" + safe(cn.id) + "</title>" +
      "<style>" +
        "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18mm 18mm 18mm 18mm;color:#111;}" +
        "h1{font-size:22px;font-weight:900;margin:0 0 2px 0;}" +
        ".meta{font-size:12px;opacity:.7;margin:0 0 18px 0;}" +
        ".grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:18px;}" +
        ".field label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#666;margin-bottom:2px;}" +
        ".field .val{font-size:14px;font-weight:600;}" +
        ".amount-box{border:2px solid #111;border-radius:8px;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;}" +
        ".amount-box .lbl{font-size:13px;font-weight:700;}" +
        ".amount-box .val{font-size:20px;font-weight:900;}" +
        "table{width:100%;border-collapse:collapse;margin-bottom:18px;}" +
        "th,td{border:1px solid #ddd;padding:7px 10px;text-align:left;font-size:12px;}" +
        "th{background:#f5f5f5;font-size:11px;text-transform:uppercase;letter-spacing:.3px;}" +
        ".status-badge{display:inline-block;padding:4px 14px;border-radius:999px;font-weight:900;font-size:13px;color:" + statusColor + ";border:2px solid " + statusColor + ";}" +
        ".balance{border:1px solid #eee;border-radius:8px;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;}" +
        ".balance .lbl{font-size:12px;color:#555;}" +
        ".balance .val{font-size:18px;font-weight:900;}" +
        "@media print{body{margin:10mm;} .no-print{display:none!important;}}" +
      "</style></head><body>" +
      "<div style='display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;'>" +
        "<div><h1>Credit Note</h1><div class='meta'>#" + safe(cn.id) + " • Issued: " + safe(cDmy(cn.issue_date)) + " • Printed: " + safe(new Date().toLocaleString()) + "</div></div>" +
        "<div class='status-badge'>" + safe(status) + "</div>" +
      "</div>" +
      "<div class='grid'>" +
        "<div class='field'><label>Client</label><div class='val'>" + safe(cn.client_name + " " + cn.client_surname) + "</div></div>" +
        "<div class='field'><label>Telephone</label><div class='val'>" + safe(cn.telephone) + "</div></div>" +
        (cn.email ? "<div class='field'><label>Email</label><div class='val'>" + safe(cn.email) + "</div></div>" : "") +
        (cn.receipt_number ? "<div class='field'><label>Receipt #</label><div class='val'>" + safe(cn.receipt_number) + "</div></div>" : "") +
        "<div class='field'><label>Expiry</label><div class='val'>" + safe(expiry) + "</div></div>" +
      "</div>" +
      "<div class='amount-box'><div class='lbl'>Credit Note Amount</div><div class='val'>" + safe(cEuro(cn.amount)) + "</div></div>" +
      "<div style='font-weight:900;margin:0 0 8px 0;font-size:13px;'>Purchase History</div>" +
      "<table><thead><tr><th>Date / Time</th><th>Receipt #</th><th style='text-align:right'>Amount</th></tr></thead><tbody>" + entriesHtml + "</tbody></table>" +
      "<div class='balance'><div class='lbl'>Remaining Balance</div><div class='val' style='color:" + (remaining > 0 ? "#067647" : "#b42318") + "'>" + safe(cEuro(remaining)) + "</div></div>" +
      (nHtml ? "<div style='margin-top:18px'><div style='font-weight:900;margin-bottom:6px;font-size:13px;'>Notes</div>" + nHtml + "</div>" : "") +
      "</body></html>";
  }
  function printOne(id) {
    var row = S.entries.find(function (x) { return String(x.id) === String(id); }); if (!row) return;
    var html = printHtml(classicRow(row)); E.cnLastPrint = html;
    var w = E.openPrint ? E.openPrint(html, { delay: 150 }) : null;
    if (!w) E.toast("The print page was blocked. Allow pop-ups for this site, then press Print again.", "error");
  }

  function card(cn) {
    var rem = left(cn), old = expired(cn);
    var sub = [];
    if (cn.telephone) sub.push('<a href="tel:' + esc(String(cn.telephone).replace(/\s+/g, "")) + '">' + esc(cn.telephone) + "</a>");
    sub.push(eur(cn.amount) + " from " + esc(dm(cn.issue_date))); if (cn.receipt_number) sub.push("Receipt " + esc(cn.receipt_number));
    sub.push(cn.no_expiry || !cn.expiry_date ? "No end date" : (old ? "Expired " : "Until ") + esc(dm(cn.expiry_date)));
    var h = '<div class="cnr-card' + (old ? " old" : "") + '" data-cn="' + esc(cn.id) + '"><div class="h"><b>' + esc(cn.client_name) + " " + esc(cn.client_surname) + "</b><em>" + eur(rem) + ' left</em></div><div class="s">' + sub.join(" · ") + "</div>" + E.correct.mark("cnreg", cn) + usesHtml(cn) + notesHtml(cn);
    if (S.using === cn.id) {
      h += '<form class="cnr-in" id="cnr-use" autocomplete="off"><label><span>Using €</span><input name="amount" inputmode="decimal" value="' + esc(S.draft.amount || "") + '" placeholder="0.00"></label>' +
        '<label><span>Receipt no.</span><input name="receipt_number" value="' + esc(S.draft.receipt_number || "") + '" placeholder="Optional"></label>' + (S.err ? '<div class="cnr-err" id="cnr-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="all" data-act="all">Use all ' + eur(rem) + '</button><button type="button" class="cnr-btn" data-act="cancel">Cancel</button><button type="submit" class="cnr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Use") + "</button></div></form>";
    } else { var who = cn.client_name + " " + cn.client_surname;
      h += '<div class="a"><span><button type="button" class="cnr-lnk" data-act="print" data-id="' + esc(cn.id) + '" aria-label="' + esc("Print the credit note for " + who) + '">Print</button>' +
        (S.noting && String(S.noting.cn) === String(cn.id) ? "" : '<button type="button" class="cnr-lnk" data-act="note" data-id="' + esc(cn.id) + '" aria-label="' + esc("Add a note to the credit note for " + who) + '">Add a note</button>') +
        '</span><span class="r">' + E.correct.button("cnreg", cn, "the credit note for " + who) + (rem > 0 && !old ? '<button class="cnr-btn p" data-act="use" data-id="' + cn.id + '">Use</button>' : "") + "</span></div>"; }
    return h + E.correct.panel("cnreg", cn, FIX) + "</div>";
  }

  // Every credit note issued in a month (any month, used up or not), and the classic printout of the list.
  var HIST = { dep: function () { return S.loading ? undefined : S.entries; }, title: "Issued by month", label: "Credit notes issued", nowText: "No credit note issued this month yet.",
    active: function () { return E.state.activeModuleId === "cnreg"; }, paint: function () { paint(); },
    fetch: async function (ym) { return (await fetchAll()).filter(function (cn) { return String(cn.issue_date || "").slice(0, 7) === ym; }).sort(function (a, b) { return String(b.issue_date).localeCompare(String(a.issue_date)) || b.id - a.id; }); },
    row: function (cn) { return { t: (cn.client_name || "") + " " + (cn.client_surname || ""), s: [dm(cn.issue_date), eur(cn.amount), cn.receipt_number ? "Receipt " + cn.receipt_number : "", cn.telephone].filter(Boolean).join(" · "), r: eur(left(cn)) + " left" }; },
    print: function (ym, rows) {
      E.months.print({ register: "Credit Notes", month: ym, sections: [{ cols: ["Date", "Client", "Telephone", { h: "Balance / Total", num: true }, "Status"],
        rows: rows.slice().reverse().map(function (r) { return [E.months.dmy(r.issue_date), (r.client_name || "") + " " + (r.client_surname || ""), r.telephone || "", eur(left(r)) + " / " + eur(r.amount), left(r) > 0.004 ? "Open" : "Closed"]; }) }] });
    } };
  function listHtml() { // what the search narrows: redrawn on its own while typing, so nothing else moves
    var h = "", q = low(S.q).trim(), match = function (cn) { return !q || [cn.client_name + " " + cn.client_surname, cn.client_surname + " " + cn.client_name, cn.telephone, cn.receipt_number].some(function (v) { return low(v).indexOf(q) >= 0; }); };
    var withMoney = S.entries.filter(function (cn) { return left(cn) > 0; });
    var open = withMoney.filter(function (cn) { return !expired(cn) && match(cn); }), old = withMoney.filter(function (cn) { return expired(cn) && match(cn); });
    if (!q) h += '<p class="cnr-sum"><b>' + withMoney.filter(function (cn) { return !expired(cn); }).length + "</b> open, <b>" + eur(withMoney.filter(function (cn) { return !expired(cn); }).reduce(function (t, cn) { return t + left(cn); }, 0)) + "</b> owed to customers.</p>";
    // q5-8: the first 30 notes of the screen, then "Show 30 more"; each next list gets what the one above left of the 30. Counts and the sum are every note.
    var kp = [S.using, S.undo && S.undo.cn], po = E.listPage.take("cnr:open", open, { q: q, keep: kp }), pe = E.listPage.take("cnr:old", old, { q: q, keep: kp, first: E.listPage.STEP - po.shown });
    h += '<div class="cnr-lab">Open <b>' + open.length + "</b></div>" + (open.length ? po.rows.map(card).join("") + E.listPage.moreHtml("cnr:open", po, "cnr-btn") : '<div class="cnr-quiet">' + (q ? "No open credit note for “" + esc(S.q) + "”." : "No open credit notes.") + "</div>");
    if (old.length) h += '<div class="cnr-lab">Expired with money left <b>' + old.length + "</b></div>" + pe.rows.map(card).join("") + E.listPage.moreHtml("cnr:old", pe, "cnr-btn");
    if (q) { // a search also finds notes used up: a use that took the whole note can be looked at, and undone
      var gone = S.entries.filter(function (cn) { return left(cn) <= 0 && match(cn); });
      var pg = E.listPage.take("cnr:gone", gone, { q: q, keep: kp, first: E.listPage.STEP - po.shown - pe.shown }); // was the first 20 only: now all of them, a page at a time
      if (gone.length) h += '<div class="cnr-lab">Used up <b>' + gone.length + "</b></div>" + pg.rows.map(card).join("") + E.listPage.moreHtml("cnr:gone", pg, "cnr-btn");
    }
    return h;
  }
  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "cnreg") return; // left before a reply came back: do not draw over the next screen
    var qi = m.querySelector("#cnr-q"); if (qi) S.q = qi.value;
    if (!fromState) keep();
    var h = '<div class="cnr"><button class="cnr-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("cnreg")) + '</button>' +
      '<div class="cnr-top"><div><h1>Credit notes</h1><p class="cnr-sub">Money customers have with you, and what is left of it.</p></div>' + (S.adding ? "" : '<button class="cnr-btn p" data-act="add">New credit note</button>') + "</div>";
    if (S.adding) {
      var a = S.adding, fld = function (k, label, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] || "") + '"' + (extra || "") + "></label>"; };
      h += '<form class="cnr-form" id="cnr-add" autocomplete="off">' + fld("client_name", "Name") + fld("client_surname", "Surname") + fld("telephone", "Phone", ' type="tel"') + fld("amount", "Amount €", ' inputmode="decimal" placeholder="0.00"') +
        fld("receipt_number", "Receipt no.", ' placeholder="Optional"') + fld("issue_date", "Issued", ' type="date" max="' + esc(today()) + '"') + fld("expiry_date", "Expires", ' type="date" min="' + esc(a.issue_date || today()) + '"') +
        (S.err && !S.using ? '<div class="cnr-err" id="cnr-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><span style="margin-right:auto;font-size:12.5px;color:var(--muted)">Leave Expires empty for no end date.</span><button type="button" class="cnr-btn" data-act="add-cancel">Cancel</button><button type="submit" class="cnr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save credit note") + "</button></div></form>";
    }
    if (S.loading && !S.entries.length) h += '<div class="cnr-quiet">Opening credit notes…</div>';
    else if (S.error) h += '<div class="cnr-quiet">' + esc(S.error) + "</div>";
    else {
      h += '<input class="cnr-q" id="cnr-q" type="search" aria-label="Find a customer by name, phone or receipt number" aria-controls="cnr-list" placeholder="Customer name, phone or receipt" value="' + esc(S.q) + '">';
      h += '<div id="cnr-list">' + listHtml() + "</div>";
    }
    h += E.months.history("cnreg", HIST);
    h += (E.correct.can() ? E.correct.foot("", "Deleting a credit note is") : E.correct.foot('Deleting a credit note is in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.')) + "</div>";
    var ae = document.activeElement, sel = ae && m.contains(ae) ? (ae.id === "cnr-q" ? "#cnr-q" : ae.name ? "[name=" + ae.name + "]" : "") : "";
    m.innerHTML = h;
    if (sel) { var again = m.querySelector(sel); if (again) { again.focus(); try { var L = again.value.length; again.setSelectionRange(L, L); } catch (x) {} } }
    E.months.wireHistory(m, "cnreg");
    wireActs(m);
    var qn = m.querySelector("#cnr-q"); if (qn) qn.addEventListener("input", function () { // only the list follows the typing
      S.q = qn.value; keep(); var L = m.querySelector("#cnr-list"); if (!L) return paint();
      L.innerHTML = listHtml(); wireActs(L); wireForms(L);
    });
    wireForms(m);
    m.addEventListener("keydown", onEsc);
    var fa = m.querySelector("#cnr-add"); if (fa) fa.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
  }
  function wireForms(root) {
    var fu = root.querySelector("#cnr-use"); if (fu) fu.addEventListener("submit", function (ev) { ev.preventDefault(); use(); });
    var fn = root.querySelector("#cnr-note"); if (fn) fn.addEventListener("submit", function (ev) { ev.preventDefault(); addNote(); });
  }
  function onEsc(ev) {
    var inAsk = ev.key === "Escape" && ev.target && ev.target.closest && ev.target.closest(".cnr-ask");
    if (inAsk && S.undo && !S.undo.busy) { ev.preventDefault(); var q = S.undo; S.undo = null; paint(true); focusUndo(q); }
    else if (inAsk && S.rmNote && !S.rmNote.busy) { ev.preventDefault(); var r = S.rmNote; S.rmNote = null; paint(true); focusBtn('[data-act=rmnote][data-id="' + r.cn + '"][data-nid="' + r.nid + '"]'); }
    else if (ev.key === "Escape" && S.noting && !S.noting.busy && ev.target && ev.target.closest && ev.target.closest("#cnr-note")) { ev.preventDefault(); keep(); var o = S.noting; S.noting = null; paint(true); focusBtn('[data-act=note][data-id="' + o.cn + '"]'); }
  }
  function focusBtn(sel) { var b = S.mount && S.mount.querySelector(sel); if (b) b.focus(); }
  function wireActs(root) {
    var m = S.mount;
    E.correct.wire(root, "cnreg", FIX); // the whole screen, or only the list the search redrew
    root.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash("cnreg");
        else if (act === "add") { S.adding = { issue_date: today() }; S.using = null; S.err = ""; paint(true); setTimeout(function () { var f = m.querySelector("[name=client_name]"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; paint(true); }
        else if (act === "use") { S.using = Number(b.getAttribute("data-id")); S.draft = {}; S.err = ""; S.adding = null; S.undo = null; paint(true); setTimeout(function () { var f = m.querySelector("#cnr-use [name=amount]"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (act === "all") { var cn = S.entries.find(function (x) { return x.id === S.using; }); keep(); S.draft.amount = cn ? left(cn).toFixed(2) : ""; paint(true); }
        else if (act === "cancel") { S.using = null; S.err = ""; paint(true); }
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "cnreg"); } catch (x) {} E.openClassic("creditnotes"); }
        else if (act === "undo") { if (!E.correct.can()) return; keep(); S.undo = { cn: b.getAttribute("data-id"), pid: b.getAttribute("data-pid"), busy: false, err: "" }; S.rmNote = null; S.using = null; S.err = ""; paint(true); var y = m.querySelector("[data-act=undo-yes]"); if (y) y.focus(); }
        else if (act === "undo-no") { var q0 = S.undo; S.undo = null; paint(true); if (q0) focusUndo(q0); }
        else if (act === "undo-yes") undoUse();
        else if (act === "q58-more") { var nx = E.listPage.more(b.getAttribute("data-key")); paint(true); if (nx != null) E.focusSoon(function () { var c = S.mount && S.mount.querySelector('.cnr-card[data-cn="' + nx + '"]'); if (!c) return null; var t = c.querySelector("button"); if (t) return t; c.setAttribute("tabindex", "-1"); return c; }); } // q5-8: the first new note
        else if (act === "print") printOne(b.getAttribute("data-id"));
        else if (act === "note") { keep(); S.noting = { cn: b.getAttribute("data-id"), text: "", err: "", busy: false }; S.using = null; S.err = ""; paint(true); E.focusSoon(m.querySelector("#cnr-note [name=note_text]")); }
        else if (act === "note-cancel") { var o0 = S.noting; S.noting = null; paint(true); if (o0) focusBtn('[data-act=note][data-id="' + o0.cn + '"]'); }
        else if (act === "rmnote") { if (!E.correct.can()) return; keep(); S.rmNote = { cn: b.getAttribute("data-id"), nid: b.getAttribute("data-nid"), busy: false, err: "" }; S.undo = null; paint(true); focusBtn("[data-act=rmnote-yes]"); }
        else if (act === "rmnote-no") { var r0 = S.rmNote; S.rmNote = null; paint(true); if (r0) focusBtn('[data-act=rmnote][data-id="' + r0.cn + '"][data-nid="' + r0.nid + '"]'); }
        else if (act === "rmnote-yes") removeNote();
      });
    });
  }

  function focusUndo(q) { var b = S.mount && S.mount.querySelector('[data-act=undo][data-id="' + q.cn + '"][data-pid="' + q.pid + '"]'); if (b) b.focus(); }
  // Undo a use: the classic removal, the pharmacist only. A lost answer counts as done only when the use is gone.
  async function undoUse() {
    var q = S.undo; if (!q || q.busy || !E.correct.can()) return;
    var cn0 = S.entries.find(function (x) { return String(x.id) === String(q.cn); }) || {}, u0 = (cn0.purchase_entries || []).find(function (p) { return String(p.id) === String(q.pid); }) || {};
    q.busy = true; q.err = ""; paint(true);
    var path = "/creditnotes/entries/" + encodeURIComponent(String(q.cn)) + "/purchases/" + encodeURIComponent(String(q.pid));
    try {
      try { var r = await E.apiFetch(path, { method: "DELETE" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not undo"); }
      catch (x0) {
        if (!(x0 && (x0.network || x0.status === 404))) throw x0;
        var again = (await fetchAll()).find(function (x) { return String(x.id) === String(q.cn); });
        if (!again || (again.purchase_entries || []).some(function (p) { return String(p.id) === String(q.pid); })) throw x0;
      }
    } catch (x) {
      if (S.undo === q) { q.busy = false; q.err = E.saveFailText(x) + ". The use is still on the note."; paint(true); var y = S.mount && S.mount.querySelector("[data-act=undo-yes]"); if (y) y.focus(); }
      return;
    }
    S.undo = null;
    E.toast("Use undone · " + eur(u0.amount) + " is back on the note for " + (cn0.client_name || "the customer"), "success");
    await load();
    var c = S.mount && S.mount.querySelector('.cnr-card[data-cn="' + q.cn + '"]'), to = c && (c.querySelector("[data-act=use]") || c.querySelector("[data-act=undo]"));
    (to || (S.mount && S.mount.querySelector("#cnr-q")) || { focus: function () {} }).focus();
  }

  // Add a note: the classic POST …/notes { text } (the text trimmed, as the classic does). A lost answer counts as done
  // only when the note is there, so a note is never added twice.
  async function addNote() {
    var o = S.noting; if (!o || o.busy) return;
    keep(); var text = String(o.text || "").trim(); o.err = "";
    if (!text) { o.err = "Write the note first. Nothing was saved."; paint(true); var el = S.mount.querySelector("#cnr-note [name=note_text]"); if (el) { el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", "cnr-nerr"); el.focus(); el.addEventListener("input", function () { el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); }, { once: true }); } return; }
    var cn0 = S.entries.find(function (x) { return String(x.id) === String(o.cn); }) || {}, had = (cn0.notes || []).filter(function (n) { return String(n.text) === text; }).length;
    o.busy = true; paint(true); var since = Date.now(), from = document.activeElement;
    try {
      try { var r = await E.apiFetch("/creditnotes/entries/" + encodeURIComponent(String(o.cn)) + "/notes", { method: "POST", body: JSON.stringify({ text: text }) }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not save the note"); }
      catch (x0) {
        if (!(x0 && x0.network)) throw x0;
        var again = (await fetchAll()).find(function (x) { return String(x.id) === String(o.cn); });
        if (!again || (again.notes || []).filter(function (n) { return String(n.text) === text; }).length <= had) throw x0;
      }
    } catch (x) {
      if (S.noting === o) { o.busy = false; o.err = E.saveFailText(x) + ". The note is kept here."; paint(true); var f = S.mount && S.mount.querySelector("#cnr-note [name=note_text]"); if (f) f.focus(); }
      return;
    }
    S.noting = null;
    E.toast("Note saved · " + (cn0.client_name || "credit note"), "success");
    await load();
    E.focusIfIdle(S.mount && S.mount.querySelector('[data-act=note][data-id="' + o.cn + '"]'), since, from);
  }
  // Remove a note: the classic removal, the pharmacist only, after one question. A lost answer counts as done only
  // when the note is gone.
  async function removeNote() {
    var q = S.rmNote; if (!q || q.busy || !E.correct.can()) return;
    q.busy = true; q.err = ""; paint(true); var since = Date.now(), from = document.activeElement;
    var path = "/creditnotes/entries/" + encodeURIComponent(String(q.cn)) + "/notes/" + encodeURIComponent(String(q.nid));
    try {
      try { var r = await E.apiFetch(path, { method: "DELETE" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not remove the note"); }
      catch (x0) {
        if (!(x0 && (x0.network || x0.status === 404))) throw x0;
        var again = (await fetchAll()).find(function (x) { return String(x.id) === String(q.cn); });
        if (!again || (again.notes || []).some(function (n) { return String(n.id) === String(q.nid); })) throw x0;
      }
    } catch (x) {
      if (S.rmNote === q) { q.busy = false; q.err = E.saveFailText(x) + ". The note is still there."; paint(true); focusBtn("[data-act=rmnote-yes]"); }
      return;
    }
    S.rmNote = null;
    E.toast("Note removed", "success");
    await load();
    E.focusIfIdle(S.mount && S.mount.querySelector('[data-act=note][data-id="' + q.cn + '"]'), since, from);
  }

  function keep() {
    var m = S.mount; if (!m) return;
    var fu = m.querySelector("#cnr-use"); if (fu) ["amount", "receipt_number"].forEach(function (k) { var el = fu.querySelector("[name=" + k + "]"); if (el) S.draft[k] = el.value; });
    var fn = m.querySelector("#cnr-note [name=note_text]"); if (fn && S.noting) S.noting.text = fn.value;
    var fa = m.querySelector("#cnr-add"); if (fa && S.adding) ["client_name", "client_surname", "telephone", "amount", "receipt_number", "issue_date", "expiry_date"].forEach(function (k) { var el = fa.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || "").trim(); });
  }

  // The box with the problem: marked, tied to the message, and the cursor in it (until something is typed there).
  function markBad(sel) {
    var el = S.mount && S.mount.querySelector(sel); if (!el) return;
    el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", "cnr-err"); el.focus();
    el.addEventListener("input", function () { el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); }, { once: true });
  }
  async function use() {
    if (S.saving) return;
    keep();
    var amt = money(S.draft.amount); S.err = "";
    if (amt == null) { S.err = "Write the amount used, e.g. 12.50. Nothing was saved."; paint(true); return markBad("#cnr-use [name=amount]"); }
    S.saving = true; paint(true);
    try {
      var fresh = await fetchAll(); S.entries = fresh; // what is left right now, not when the screen opened
      var cn = fresh.find(function (x) { return x.id === S.using; });
      if (!cn) throw new Error("this credit note is no longer there");
      var rem = left(cn);
      if (expired(cn)) throw new Error("this credit note expired on " + dm(cn.expiry_date));
      if (amt > rem + 0.004) throw new Error("only " + eur(rem) + " is left on it");
      var rec = String(S.draft.receipt_number || "").trim();
      var sameUse = function (pe) { return Math.abs((Number(pe.amount) || 0) - amt) < 0.005 && String(pe.receipt_number || "") === rec; };
      var had = (cn.purchase_entries || []).filter(sameUse).length;
      try {
        var r = await E.apiFetch("/creditnotes/entries/" + encodeURIComponent(String(cn.id)) + "/purchases", { method: "POST", body: JSON.stringify({ amount: amt, receipt_number: rec }) });
        if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      } catch (x0) { // the answer was lost: did the use arrive? Never use the note twice.
        if (!(x0 && x0.network)) throw x0;
        var again = (await fetchAll()).find(function (x) { return x.id === cn.id; });
        if (!again || (again.purchase_entries || []).filter(sameUse).length <= had) throw x0;
      }
      E.toast(eur(amt) + " used · " + eur(rem - amt) + " left for " + cn.client_name, "success");
      S.using = null; S.draft = {};
    } catch (x) { S.err = E.saveFailText(x) + "."; }
    S.saving = false; return load();
  }

  async function add() {
    if (S.saving) return;
    keep();
    var a = S.adding, amt = money(a.amount), bad = ""; S.err = "";
    if (!a.client_name) { S.err = "Write the customer's name. Nothing was saved."; bad = "client_name"; }
    else if (!a.client_surname) { S.err = "Write the customer's surname. Nothing was saved."; bad = "client_surname"; }
    else if (!a.telephone) { S.err = "Write a phone number. Nothing was saved."; bad = "telephone"; }
    else if (amt == null) { S.err = "Write the amount, e.g. 15.00. Nothing was saved."; bad = "amount"; }
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(a.issue_date || "")) { S.err = "Choose the day it was issued. Nothing was saved."; bad = "issue_date"; }
    else if (a.expiry_date && a.expiry_date < a.issue_date) { S.err = "The end date is before the day it was issued. Nothing was saved."; bad = "expiry_date"; }
    if (S.err) { paint(true); return markBad("#cnr-add [name=" + bad + "]"); }
    S.saving = true; paint(true);
    try {
      var r = await E.apiFetch("/creditnotes/entries", { method: "POST", body: JSON.stringify({ issue_date: a.issue_date, client_name: a.client_name, client_surname: a.client_surname, telephone: a.telephone, email: "", receipt_number: a.receipt_number || "", amount: amt, expiry_date: a.expiry_date || "", no_expiry: 0 }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; E.toast("Saved · credit note of " + eur(amt) + " for " + a.client_name, "success");
      if (E.linkPerson) E.linkPerson({ name: a.client_name + " " + a.client_surname, phone: a.telephone }, "register:credit-notes"); // one person in Customers, found or added
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "cnreg", title: "Credit notes", order: 3, icon: "€", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; E.listPage.reset("cnr"); S.using = null; S.undo = null; S.noting = null; S.rmNote = null; S.adding = null; S.err = ""; S.q = ""; E.months.historyReset("cnreg"); E.correct.reset("cnreg"); css(); paint(); return E.takeOpenForm("cnreg", S.mount, load(), { btn: "[data-act=add]", form: "#cnr-add" }); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("cnreg") < 0) E.UI2_DESTINATIONS.push("cnreg");
  if (E.UI2_PARENT) E.UI2_PARENT.cnreg = "money";
})();
