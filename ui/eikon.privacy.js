/* ============================================================
   EIKON — One person's data  (eikon.privacy.js, E.privacy)
   For the pharmacist in charge only (the server refuses everyone else). One window, opened from the customer's
   record (⋯ › Export or erase…) or from Settings › Download our records › One person:
     - What we hold: every record of this pharmacy that names the person, table by table. Records that only share the
       name are listed apart and count only when ticked.
     - Download everything: one zip file with the data (JSON), a spreadsheet (a sheet per kind of record) and a summary
       page anyone can read or print. Made in this browser; the server writes "exported" in the audit trail.
     - Erase: a confirmation that lists exactly what changes (name, ID card and contacts removed; the record stays) and
       what is kept and why, typed name to confirm, then one request. Undo for 24 hours (the server's own limit).
   Nothing here deletes a row; nothing is sent to the person. Uses POST /people/:id/privacy, /export, /erase,
   POST /people/erasures/:id/undo (gdpr block of the worker).
   E.privacy.open(personId, { name, back, onDone(person) })
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var TZ = "Europe/Malta";
  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function str(v) { return v == null ? "" : String(v); }
  function user() { return (E.state && E.state.user) || {}; }
  function isAdmin() { var u = user(); return !u.role || u.role === "admin"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function when(v) { // server UTC "YYYY-MM-DD HH:MM:SS" → Malta "11 Nov, 17:05"
    var s = str(v); if (!s) return ""; var ms = Date.parse(s.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));
    if (isNaN(ms)) return s;
    try { return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms)); } catch (e) { return s; }
  }
  function ymd() { return E.maltaYmd(); } // Malta's day (core.js), never UTC's

  // What a column is, in a pharmacist's words (the confirmation lists what each kind of record loses).
  var WORDS = [[/surname|_first$|_last$|name$/, "name"], [/id_card|^client_id$|^patient_id$|^pt_id$|id_doc/, "ID card"], [/phone|telephone/, "phone"], [/email|to_addr/, "e-mail"],
    [/address/, "address"], [/notes|note$|notes_log/, "notes"], [/allergies/, "allergies"], [/prefers|_ok$|^lang$/, "how they like to be told"], [/subject|body/, "the message"],
    [/_json$/, "name inside the record"], [/proof/, "proof of delivery"], [/^source$/, ""]];
  function colWords(cols) {
    var out = [];
    (cols || []).forEach(function (c) { for (var i = 0; i < WORDS.length; i++) if (WORDS[i][0].test(c)) { if (WORDS[i][1] && out.indexOf(WORDS[i][1]) < 0) out.push(WORDS[i][1]); return; } });
    return out.join(", ");
  }

  function css() {
    if (document.getElementById("eikon-privacy-css")) return;
    var st = document.createElement("style"); st.id = "eikon-privacy-css";
    st.textContent =
      ".prv-ov{position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:9000;display:flex;align-items:flex-end;justify-content:center}@media (min-width:700px){.prv-ov{align-items:center}}" +
      ".prv{background:var(--panel,#fff);color:var(--text,#111);width:100%;max-width:620px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:20px 20px 16px;box-shadow:0 20px 60px rgba(0,0,0,.35);box-sizing:border-box}@media (min-width:700px){.prv{border-radius:18px}}" +
      ".prv h2{font-size:21px;margin:0 0 2px;letter-spacing:-.02em;font-weight:800}.prv h2:focus{outline:0}.prv .sub{color:var(--muted);font-size:14px;margin:0 0 12px;line-height:1.45}" +
      ".prv h3{font-size:15px;font-weight:700;margin:16px 0 6px}" +
      ".prv-list{list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:12px;overflow:hidden}.prv-list li{display:flex;gap:10px;align-items:baseline;padding:9px 12px;font-size:15px;line-height:1.35}.prv-list li+li{border-top:.5px solid var(--border)}" +
      ".prv-list .n{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}.prv-list small{display:block;color:var(--muted);font-size:13px;margin-top:2px}" +
      ".prv-maybe li{align-items:center}.prv-maybe label{display:flex;align-items:center;gap:10px;min-height:44px;cursor:pointer;flex:1}.prv-maybe input{width:20px;height:20px;accent-color:var(--accent);flex:none}" +
      ".prv-note{font-size:13.5px;color:var(--muted);margin:8px 0 0;line-height:1.45}" +
      ".prv-warn{border:1px solid var(--border);border-left:4px solid var(--danger,#B3261E);border-radius:10px;padding:10px 12px;font-size:14.5px;margin:12px 0 0;line-height:1.45}" +
      ".prv-ok{border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:10px;padding:10px 12px;font-size:14.5px;margin:12px 0 0;line-height:1.45}" +
      ".prv label.f{display:block;font-size:13px;font-weight:700;color:var(--muted);margin:14px 0 4px}.prv input.t{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;background:var(--bg,#fff);color:var(--text);font-size:16px;padding:10px 12px;font-family:inherit;min-height:44px}" +
      ".prv input.t:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px rgba(10,143,106,.2)}" +
      ".prv-err{background:rgba(191,59,46,.1);border:1px solid rgba(191,59,46,.35);color:var(--danger,#B3261E);border-radius:10px;padding:9px 12px;font-size:14px;margin-top:12px}" +
      ".prv-act{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}.prv .b{min-height:48px;padding:0 18px;border-radius:12px;border:1px solid var(--border);background:var(--panel2,#f6f6f8);color:var(--text);font:inherit;font-size:16px;font-weight:700;cursor:pointer}" +
      ".prv .b.p{background:var(--accent);border-color:var(--accent);color:#fff}.prv .b.d{background:transparent;border-color:var(--danger,#B3261E);color:var(--danger,#B3261E)}.prv .b.dd{background:var(--danger,#B3261E);border-color:var(--danger,#B3261E);color:#fff}" +
      ".prv .b:disabled,.prv .b[aria-disabled=true]{opacity:.55;cursor:default}.prv .b:focus-visible,.prv input:focus-visible{outline:3px solid var(--accent);outline-offset:2px}.prv-act .sp{flex:1}" +
      ".prv .lnk{border:0;background:none;color:var(--accent);font:inherit;font-size:14px;font-weight:600;padding:0;min-height:44px;cursor:pointer}" +
      "@media (max-width:520px){.prv-act .b{flex:1 1 100%}.prv-act .sp{display:none}}" +
      "@media (prefers-color-scheme: dark){.prv-ov{background:rgba(0,0,0,.62)}.prv{box-shadow:0 0 0 1px var(--border),0 20px 60px rgba(0,0,0,.6)}html[data-ui2]:not([data-ui2-visit]) .prv .b.p,html[data-ui2]:not([data-ui2-visit]) .prv .b.dd{color:#00160E}}"; // dark text on the light dark-mode colours, as every primary button
    document.head.appendChild(st);
  }

  // ---- the file -----------------------------------------------------------------------------------------------
  var CRC = null;
  function crc32(b) { if (!CRC) { CRC = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } } var x = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) x = CRC[(x ^ b[i]) & 0xFF] ^ (x >>> 8); return (x ^ 0xFFFFFFFF) >>> 0; }
  // A store-only zip; each file's data is text or bytes.
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], off = 0, now = new Date();
    var dosT = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosD = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    function hdr(len) { var b = new Uint8Array(len); return { b: b, v: new DataView(b.buffer) }; }
    files.forEach(function (f) {
      var nm = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : new Uint8Array(f.data), crc = crc32(data);
      var L = hdr(30); L.v.setUint32(0, 0x04034b50, true); L.v.setUint16(4, 20, true); L.v.setUint16(6, 0x0800, true); L.v.setUint16(10, dosT, true); L.v.setUint16(12, dosD, true);
      L.v.setUint32(14, crc, true); L.v.setUint32(18, data.length, true); L.v.setUint32(22, data.length, true); L.v.setUint16(26, nm.length, true);
      var C = hdr(46); C.v.setUint32(0, 0x02014b50, true); C.v.setUint16(4, 20, true); C.v.setUint16(6, 20, true); C.v.setUint16(8, 0x0800, true); C.v.setUint16(12, dosT, true); C.v.setUint16(14, dosD, true);
      C.v.setUint32(16, crc, true); C.v.setUint32(20, data.length, true); C.v.setUint32(24, data.length, true); C.v.setUint16(28, nm.length, true); C.v.setUint32(42, off, true);
      parts.push(L.b, nm, data); central.push(C.b, nm); off += 30 + nm.length + data.length;
    });
    var csize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var Z = hdr(22); Z.v.setUint32(0, 0x06054b50, true); Z.v.setUint16(8, files.length, true); Z.v.setUint16(10, files.length, true); Z.v.setUint32(12, csize, true); Z.v.setUint32(16, off, true);
    return new Blob(parts.concat(central, [Z.b]), { type: "application/zip" });
  }
  function cellText(v) { return v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v; }
  function sheetRows(sec) {
    var cols = [];
    sec.rows.forEach(function (r) { var o = r.entry ? Object.assign({ row_id: r.row_id }, r.record || {}, r.entry, { _matched: r.matched }) : r; Object.keys(o).forEach(function (k) { if (cols.indexOf(k) < 0) cols.push(k); }); });
    return [cols].concat(sec.rows.map(function (r) { var o = r.entry ? Object.assign({ row_id: r.row_id }, r.record || {}, r.entry, { _matched: r.matched }) : r; return cols.map(function (k) { return cellText(o[k]); }); }));
  }
  function csv(rows) {
    var cell = function (v) { var s = v == null ? "" : String(v); if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return "﻿" + rows.map(function (r) { return r.map(cell).join(","); }).join("\r\n") + "\r\n";
  }
  function summaryHtml(x) {
    var p = x.person || {}, made = when(x.made_at && x.made_at.replace("T", " ").replace(/\.\d+Z$/, "Z"));
    var rows = function (sec) {
      return sec.rows.map(function (r) {
        var o = r.entry || r, date = str(o.entry_date || o.order_date || o.open_date || o.date || o.given_on || o.txn_date || o.issue_date || o.sale_date || o.performed_at_iso || o.created_at || o.updated_at).slice(0, 10);
        var what = str(o.items_text || o.issue || o.medicine_name_dose || o.vaccine_name || o.test_label || o.items || o.subject || o.receipt_number || o.receipt_no || o.notes || o.drug || (o.report_json && o.report_json.reaction) || "");
        return "<tr><td>" + esc(date) + "</td><td>" + esc(what.slice(0, 160)) + "</td><td>" + esc(r._matched || r.matched || "") + "</td></tr>";
      }).join("");
    };
    return "<!doctype html><html lang='en'><head><meta charset='utf-8'><title>Everything we hold on " + esc(p.name) + "</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:24px;color:#000;background:#fff;max-width:900px}" +
      "h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 6px}p{font-size:13px;margin:4px 0}table{width:100%;border-collapse:collapse;margin-top:4px}th,td{border:1px solid #000;padding:4px 6px;font-size:12px;text-align:left;vertical-align:top}th{background:#eee}dl{display:grid;grid-template-columns:160px 1fr;gap:2px 12px;font-size:13px}dt{font-weight:700}</style></head><body>" +
      "<h1>Everything " + esc(x.pharmacy && x.pharmacy.name || "the pharmacy") + " holds on " + esc(p.name) + "</h1><p>Made " + esc(made) + " (Malta time) by " + esc(x.made_by && (x.made_by.name || x.made_by.email) || "") + ". " + esc(plural(x.rows || 0, "record")) + " in " + esc(plural((x.sections || []).length, "kind")) + " of record. Only this pharmacy's records.</p>" +
      "<h2>Their details</h2><dl>" + [["Name", p.name], ["ID card", p.id_card], ["Phone", p.phone], ["Other phone", p.alt_phone], ["E-mail", p.email], ["Address", p.address], ["Doctor", p.doctor_name], ["Date of birth", p.date_of_birth], ["Notes", p.notes]].filter(function (r) { return r[1]; }).map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("") + "</dl>" +
      (x.sections || []).map(function (s) { return "<h2>" + esc(s.label) + " (" + s.rows.length + ")</h2>" + (s.on_erase === "kept" && s.why_kept ? "<p>" + esc(s.why_kept) + "</p>" : "") + "<table><thead><tr><th>Date</th><th>What</th><th>Why it is listed</th></tr></thead><tbody>" + rows(s) + "</tbody></table>"; }).join("") +
      "<p style='margin-top:20px'>The complete data, every column of every record, is in the .json file and the spreadsheet next to this page.</p></body></html>";
  }
  async function makeFile(x) {
    var p = x.person || {}, base = "Everything-we-hold-" + (str(p.name).normalize("NFD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "person-" + p.id) + "-" + ymd();
    var files = [{ name: base + ".json", data: JSON.stringify(x, null, 2) }, { name: base + "-summary.html", data: summaryHtml(x) }];
    if (!window.XLSX && E.loadVendor) { try { await E.loadVendor("xlsx"); } catch (e) {} }
    var X = window.XLSX;
    if (X && X.utils && X.write) {
      var wb = X.utils.book_new(), used = {};
      var nameOf = function (t) { var s = String(t).replace(/[\[\]\*\?\/\\:]/g, " ").slice(0, 31), n = s, i = 2; while (used[n.toLowerCase()]) n = s.slice(0, 28) + " " + i++; used[n.toLowerCase()] = 1; return n; };
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Person", p.name], ["Pharmacy", x.pharmacy && x.pharmacy.name || ""], ["Made", x.made_at], ["Records", x.rows], [], ["Kind of record", "Rows", "If erased"]].concat((x.sections || []).map(function (s) { return [s.label, s.rows.length, s.on_erase === "kept" ? "Kept: " + s.why_kept : "Name and contacts removed"]; }))), nameOf("Summary"));
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([Object.keys(p)].concat([Object.keys(p).map(function (k) { return cellText(p[k]); })])), nameOf("Customer record"));
      (x.sections || []).forEach(function (s) { X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(sheetRows(s)), nameOf(s.label)); });
      files.push({ name: base + ".xlsx", data: X.write(wb, { bookType: "xlsx", type: "array", compression: true }) });
    } else {
      (x.sections || []).forEach(function (s) { files.push({ name: base + "-" + s.table + ".csv", data: csv(sheetRows(s)) }); });
    }
    var blob = zip(files), name = base + ".zip";
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; a.style.display = "none"; document.body.appendChild(a);
    try { a.click(); } catch (e) {}
    a.remove(); setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
    E.privacy.lastFile = { name: name, size: blob.size, files: files.map(function (f) { return f.name; }), blob: blob };
    return E.privacy.lastFile;
  }

  // ---- the window ---------------------------------------------------------------------------------------------
  async function open(personId, o) {
    o = o || {}; css();
    var id = Number(personId) || 0; if (!id) return;
    var back = o.back || document.activeElement;
    var S = { view: "load", data: null, ticked: {}, error: "", busy: false, typed: "", reason: "", done: null, name: o.name || "" };
    var ov = document.createElement("div"); ov.className = "prv-ov"; ov.setAttribute("data-privacy-window", "");
    ov.innerHTML = '<div class="prv" role="dialog" aria-modal="true" aria-labelledby="prv-h"></div>';
    document.body.appendChild(ov);
    var box = ov.querySelector(".prv"), closed = false;
    function close() {
      if (closed) return; closed = true; document.removeEventListener("keydown", onKey, true); ov.remove();
      try { var b = typeof back === "function" ? back() : back; if (b && b.isConnected) b.focus(); } catch (e) {} // back may be an element or a function that finds it (customers' ⋯)
      if (S.done && o.onDone) try { o.onDone(S.done.person || null); } catch (e) {}
    }
    function onKey(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); if (S.view === "confirm" && !S.busy) { S.view = "hold"; S.error = ""; paint("#prv-h"); } else if (!S.busy) close(); return; }
      if (ev.key === "Tab") {
        var f = Array.prototype.filter.call(box.querySelectorAll("button,a[href],input,[tabindex='0']"), function (x) { return !x.disabled && x.offsetParent !== null; });
        if (!f.length) return; var a = document.activeElement;
        if (ev.shiftKey && (a === f[0] || !box.contains(a))) { ev.preventDefault(); f[f.length - 1].focus(); }
        else if (!ev.shiftKey && a === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener("keydown", onKey, true);
    ov.addEventListener("mousedown", function (ev) { if (ev.target === ov && !S.busy) close(); });

    function picked() { return Object.keys(S.ticked).filter(function (k) { return S.ticked[k]; }); }
    async function load(focusSel) {
      S.error = "";
      try { S.data = await E.apiFetch("/people/" + id + "/privacy", { method: "POST", body: JSON.stringify({ rows: picked() }) }); S.name = S.data.person.name; if (S.view === "load") S.view = "hold"; }
      catch (e) { S.error = e && e.status === 403 ? "Only the pharmacist in charge (an administrator) can open this." : e && e.network ? "No connection. Try again when it is back." : "Could not read: " + str(e && e.message || e); if (S.view === "load") S.view = "fail"; }
      paint(focusSel || "#prv-h");
    }

    function holdHtml() {
      var d = S.data, secs = (d.sections || []).filter(function (s) { return s.sure > 0; }), maybe = [];
      (d.sections || []).forEach(function (s) { (s.maybe || []).forEach(function (m) { maybe.push({ m: m, label: s.label }); }); });
      var total = secs.reduce(function (a, s) { return a + s.sure; }, 0);
      var h = '<h2 id="prv-h" tabindex="-1">' + esc(S.name) + ": what we hold</h2><p class='sub'>Every record of this pharmacy that names them. " + esc(plural(total, "record")) + ", of " + esc(plural(secs.length, "kind")) + ".</p>";
      if (d.person.erased) {
        h += '<div class="prv-ok" role="status">This person was erased' + (d.open_erasure ? " on " + esc(when(d.open_erasure.at)) + ". You can undo it until " + esc(when(d.open_erasure.undo_until)) + "." : ". It cannot be undone any more.") + "</div>";
      }
      h += '<ul class="prv-list">' + secs.map(function (s) { return "<li><span>" + esc(s.label) + "</span><span class='n'>" + s.sure + "</span></li>"; }).join("") + "</ul>";
      if (maybe.length) {
        h += "<h3>Same name, not sure it is them (" + maybe.length + ")</h3><p class='prv-note'>Tick only the ones that are this person. Unticked records are left out of the file and are never erased.</p><ul class='prv-list prv-maybe'>" +
          maybe.map(function (x) { var k = x.m.key; return "<li><label><input type='checkbox' data-key='" + esc(k) + "'" + (S.ticked[k] ? " checked" : "") + "><span>" + esc(x.label) + " · " + esc(x.m.date || "") + (x.m.title ? " · " + esc(x.m.title) : "") + "<small>" + esc(x.m.name) + " — " + esc(x.m.why) + "</small></span></label></li>"; }).join("") + "</ul>";
      }
      if (S.error) h += '<p class="prv-err" role="alert">' + esc(S.error) + "</p>";
      if (S.saved) h += '<p class="prv-ok" role="status">Saved ' + esc(S.saved.name) + ": the data, a spreadsheet and a summary page. It holds personal details: keep it safe.</p>";
      h += '<div class="prv-act">' + (d.open_erasure ? '<button class="b" data-act="undo"' + (S.busy ? " disabled" : "") + ">Undo the erase</button>" : !d.person.erased ? '<button class="b d" data-act="erase"' + (S.busy ? " disabled" : "") + ">Erase this person…</button>" : "") +
        '<span class="sp"></span><button class="b" data-act="close">Close</button><button class="b p" data-act="download"' + (S.busy ? " disabled" : "") + ">" + (S.busy === "download" ? "Making the file…" : "Download everything") + "</button></div>";
      return h;
    }
    function confirmHtml() {
      var d = S.data, nm = S.name;
      var change = (d.sections || []).filter(function (s) { return s.change > 0; }), keep = (d.sections || []).filter(function (s) { return s.keep > 0; }), other = (d.sections || []).reduce(function (a, s) { return a + (s.other || 0); }, 0);
      var h = '<h2 id="prv-h" tabindex="-1">Erase ' + esc(nm) + "?</h2><p class='sub'>This removes their name, ID card and contact details from Eikon. Records stay where other records need them, as “Erased person #" + esc(d.person.id) + "”.</p>";
      h += "<h3>Removed: name, ID card and contacts (" + esc(plural(d.total_change, "record")) + ")</h3><ul class='prv-list'>" + change.map(function (s) { return "<li><span>" + esc(s.label) + "<small>" + esc(s.table === "cust_profile" ? "blanked: " + colWords(s.columns) + " (the row is kept, empty)" : colWords(s.columns)) + "</small></span><span class='n'>" + s.change + "</span></li>"; }).join("") + "</ul>";
      var keepList = function (list) { return "<ul class='prv-list'>" + list.map(function (s) { return "<li><span>" + esc(s.label) + "</span><span class='n'>" + s.keep + "</span></li>"; }).join("") + "</ul>"; };
      var sum = function (list) { return list.reduce(function (a, s) { return a + s.keep; }, 0); };
      var legal = keep.filter(function (s) { return s.legal; }), later = keep.filter(function (s) { return !s.legal; });
      if (legal.length) h += "<h3>Kept for now, the law may need them (" + esc(plural(sum(legal), "record")) + ")</h3>" + keepList(legal);
      if (later.length) h += "<h3>Kept, as the pharmacy decided (" + esc(plural(sum(later), "record")) + ")</h3>" + keepList(later);
      if (d.overridden && d.overridden.length) h += "<p class='prv-note'>Set in the pharmacy's settings: " + esc(d.overridden.map(function (o) { return o.label + (o.value === "erase" ? " removed" : " kept"); }).join(", ")) + ".</p>";
      h += "<p class='prv-note'>Also kept: the audit trail and the ID card change log (who changed what, and when), and any “stop e-mails” the person asked for." + (other ? " " + esc(plural(other, "record")) + " with the same name or card but someone else's details are left alone." : "") + "</p>";
      h += '<p class="prv-warn"><b>You can undo this for 24 hours. After that it cannot be undone.</b></p>';
      h += '<label class="f" for="prv-typed">Type ' + esc(nm) + ' to confirm</label><input class="t" id="prv-typed" autocomplete="off" spellcheck="false" value="' + esc(S.typed) + '">';
      h += '<label class="f" for="prv-why">Why (optional, kept in the audit trail)</label><input class="t" id="prv-why" maxlength="300" autocomplete="off" placeholder="For example: asked at the counter" value="' + esc(S.reason) + '">';
      if (S.error) h += '<p class="prv-err" role="alert">' + esc(S.error) + "</p>";
      var ready = typedOk();
      h += '<div class="prv-act"><button class="b" data-act="back"' + (S.busy ? " disabled" : "") + '>Back</button><span class="sp"></span><button class="b dd" data-act="go" aria-disabled="' + (!ready || !!S.busy) + '">' + (S.busy ? "Erasing…" : "Erase " + esc(nm)) + "</button></div>";
      return h;
    }
    function doneHtml() {
      var r = S.done;
      return '<h2 id="prv-h" tabindex="-1">' + (r.undone ? "Put back" : "Erased") + "</h2><p class='prv-ok' role='status'>" +
        (r.undone ? esc(plural(r.restored, "record")) + " put back as they were." + (r.skipped && r.skipped.length ? " " + esc(plural(r.skipped.length, "record")) + " had changed since and were left as they are." : "")
          : esc(plural(r.changed, "record")) + " changed. The customer is now “" + esc(r.person && r.person.name || "") + "”." + (r.undo_until ? " You can undo this until " + esc(when(r.undo_until)) + "." : "")) + "</p>" +
        '<div class="prv-act">' + (!r.undone && r.erasure_id ? '<button class="b" data-act="undo2"' + (S.busy ? " disabled" : "") + ">Undo</button>" : "") + '<span class="sp"></span><button class="b p" data-act="close">Done</button></div>';
    }
    function typedOk() { var t = S.typed.trim().replace(/\s+/g, " ").toLowerCase(); return !!t && (t === S.name.trim().replace(/\s+/g, " ").toLowerCase() || t === "erase"); }

    function paint(focusSel) {
      var h;
      if (S.view === "load") h = '<h2 id="prv-h" tabindex="-1">' + esc(S.name || "This person") + ": what we hold</h2><p class='sub' role='status'>Reading every register…</p>";
      else if (S.view === "fail") h = '<h2 id="prv-h" tabindex="-1">' + esc(S.name || "This person") + '</h2><p class="prv-err" role="alert">' + esc(S.error) + '</p><div class="prv-act"><button class="b" data-act="close">Close</button><button class="b p" data-act="retry">Try again</button></div>';
      else if (S.view === "confirm") h = confirmHtml();
      else if (S.view === "done") h = doneHtml();
      else h = holdHtml();
      box.innerHTML = h;
      bind();
      if (focusSel) E.focusSoon(function () { return box.querySelector(focusSel) || box.querySelector("#prv-h"); });
    }
    function bind() {
      box.querySelectorAll("[data-act]").forEach(function (b) { b.addEventListener("click", function () { act(b.getAttribute("data-act"), b); }); });
      box.querySelectorAll("[data-key]").forEach(function (c) { c.addEventListener("change", function () { S.ticked[c.getAttribute("data-key")] = c.checked; S.saved = null; }); });
      var t = box.querySelector("#prv-typed");
      if (t) {
        t.addEventListener("input", function () { S.typed = t.value; var g = box.querySelector("[data-act=go]"); if (g) g.setAttribute("aria-disabled", String(!typedOk() || !!S.busy)); });
        t.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); act("go"); } });
      }
      var w = box.querySelector("#prv-why");
      if (w) { w.addEventListener("input", function () { S.reason = w.value; }); w.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); act("go"); } }); }
    }
    async function act(a) {
      if (a === "close") return close();
      if (a === "retry") { S.view = "load"; paint(); return load(); }
      if (a === "back") { S.view = "hold"; S.error = ""; return paint("[data-act=erase]"); }
      if (a === "download") {
        if (S.busy) return; S.busy = "download"; S.error = ""; paint();
        try { var x = await E.apiFetch("/people/" + id + "/export", { method: "POST", body: JSON.stringify({ rows: picked() }) }); S.saved = await makeFile(x); }
        catch (e) { S.error = e && e.network ? "No connection: nothing was saved. Try again when it is back." : "The file could not be made: " + str(e && e.message || e); }
        S.busy = false; return paint(S.error ? null : "[data-act=download]");
      }
      if (a === "erase") {
        S.busy = "plan"; S.error = ""; paint();
        await load(); S.busy = false; if (S.error) return paint();
        S.view = "confirm"; S.typed = ""; return paint("#prv-typed");
      }
      if (a === "go") {
        if (S.busy) return;
        if (!typedOk()) { S.error = "Type " + S.name + " (or ERASE) in the box to confirm."; paint("#prv-typed"); return; }
        S.busy = true; S.error = ""; paint();
        try {
          var r = await E.apiFetch("/people/" + id + "/erase", { method: "POST", body: JSON.stringify({ rows: picked(), confirm: true, plan: S.data.plan, reason: S.reason }) });
          S.done = r; S.view = "done"; S.busy = false; return paint("#prv-h");
        } catch (e) {
          S.busy = false;
          if (e && e.status === 409 && e.bodyJson && e.bodyJson.code === "plan_changed") { S.data = e.bodyJson; S.data.ok = true; S.error = "The records changed since you looked. Check the new list, then erase again."; return paint("#prv-typed"); }
          S.error = e && e.network ? "No connection. Nothing was erased; try again when it is back." : "Not erased: " + str(e && e.message || e);
          return paint("#prv-typed");
        }
      }
      if (a === "undo" || a === "undo2") {
        var eid = a === "undo2" ? S.done && S.done.erasure_id : S.data && S.data.open_erasure && S.data.open_erasure.erasure_id;
        if (!eid || S.busy) return; S.busy = true; S.error = ""; paint();
        try { var u = await E.apiFetch("/people/erasures/" + eid + "/undo", { method: "POST", body: "{}" }); S.done = Object.assign({ undone: true }, u); S.view = "done"; }
        catch (e) { S.error = e && e.network ? "No connection. Try again when it is back." : "Not undone: " + str(e && e.message || e); if (S.view !== "done") S.view = "hold"; }
        S.busy = false; return paint("#prv-h");
      }
    }
    paint("#prv-h");
    await load();
    return { close: close, state: S };
  }

  E.privacy = { open: open, canUse: isAdmin, zip: zip, summaryHtml: summaryHtml, colWords: colWords };
})();
