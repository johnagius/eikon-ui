/* ============================================================
   EIKON — Tell the customer  (eikon.tell.js, E.tell)
   One small window, the same on every screen, for the moment a customer needs to hear from the pharmacy:
   an order is ready, a repeat prescription is coming due, a question is answered, a delivery is coming, a booking
   is near. The words are written for you (English or Maltese) and can be changed before anything goes.
     - WhatsApp and SMS go from this phone or computer: the app opens with the message written (wa.me / sms:),
       and the person presses Send there. No paid service, nothing sent by Eikon.
     - E-mail goes through the pharmacy's own e-mail senders (Bookings, Settings, Messages), only when Send is pressed.
     - Every message is written in the customer's timeline and the audit (POST /messages). A "no" the customer gave
       for a channel, or a stop from an e-mail, is respected: that channel cannot be chosen.
     - Nothing is ever sent by itself.
   E.tell.open({ person: { id, name, phone, alt_phone, email }, purpose, ref: { kind, id }, vars: {...}, back, onSent })
   purpose: ready | repeat | answer | delivery | booking | other
   vars: items, code, medicine, due (YYYY-MM-DD), issue, answer, service, date (YYYY-MM-DD), time, slot
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var setup = null, setupAt = 0, drafts = {}, lastChannel = "";
  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function str(v) { return v == null ? "" : String(v); }

  // ---- the greeting name -------------------------------------------------------------------------------------
  // Registers write "Name Surname" (the forms ask for it), but many older lines are "Surname Name" ("Zammit Carmel").
  // The greeting takes the first word, unless that word is a common Maltese surname and the last word is not.
  var SURNAMES = ("abela agius attard axisa azzopardi baldacchino bartolo bezzina bonello bonnici borg brincat buhagiar busuttil buttigieg " +
    "calleja camilleri caruana cassar chetcuti cilia cutajar darmanin debono degiorgio ellul farrugia fenech formosa galea gatt gauci " +
    "grech micallef mallia mercieca mifsud mizzi muscat pace portelli psaila pisani refalo sammut saliba scerri schembri scicluna " +
    "spiteri tabone tanti vassallo vella xuereb zahra zammit zarb aquilina briffa cachia zerafa cauchi falzon grima magri sciberras").split(" ");
  function fold(s) { return str(s).toLowerCase().replace(/ħ/g, "h").normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function firstName(name) {
    var w = str(name).trim().split(/\s+/).filter(Boolean); if (!w.length) return "";
    if (w.length > 1 && SURNAMES.indexOf(fold(w[0])) >= 0 && SURNAMES.indexOf(fold(w[w.length - 1])) < 0) return w[w.length - 1];
    return w[0];
  }

  // ---- numbers: what wa.me and sms: want ---------------------------------------------------------------------
  // A Maltese number (8 digits) gets 356 in front; +356 7912 3456, 00356… and spaces are all the same number.
  function intl(raw) {
    var s = str(raw).trim(); if (!s) return "";
    var plus = /^\s*(\+|00)/.test(s), d = s.replace(/\D/g, ""); if (/^00/.test(s.replace(/\s/g, ""))) d = d.replace(/^00/, "");
    if (!plus && d.length === 8) d = "356" + d;
    return d.length >= 8 ? d : "";
  }
  function isMobile(raw) { var d = intl(raw); return /^356(7|9)\d{7}$/.test(d) || (!/^356/.test(d) && d.length >= 10); } // Malta mobiles start with 7 or 9
  function waLink(num, text) { return "https://wa.me/" + intl(num) + "?text=" + encodeURIComponent(text); }
  function smsLink(num, text) { return "sms:+" + intl(num) + "?&body=" + encodeURIComponent(text); } // "?&body=" works on Android and iPhone

  // ---- dates in words ----------------------------------------------------------------------------------------
  var MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MON_MT = ["Jannar", "Frar", "Marzu", "April", "Mejju", "Ġunju", "Lulju", "Awwissu", "Settembru", "Ottubru", "Novembru", "Diċembru"];
  var DAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var DAY_MT = ["il-Ħadd", "it-Tnejn", "it-Tlieta", "l-Erbgħa", "il-Ħamis", "il-Ġimgħa", "is-Sibt"];
  function today() { return (E.maltaYmd && E.maltaYmd()) || new Date().toISOString().slice(0, 10); }
  function dayWords(ymd, lang) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(ymd)); if (!m) return "";
    var t = today(), d = Date.UTC(+m[1], +m[2] - 1, +m[3]), tm = /^(\d{4})-(\d{2})-(\d{2})/.exec(t), t0 = Date.UTC(+tm[1], +tm[2] - 1, +tm[3]);
    var n = Math.round((d - t0) / 86400000), wd = new Date(d).getUTCDay();
    if (lang === "mt") { if (n === 0) return "illum"; if (n === 1) return "għada"; if (n > 1 && n < 7) return DAY_MT[wd]; return "fil-" + Number(m[3]) + " ta' " + MON_MT[+m[2] - 1]; }
    if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n > 1 && n < 7) return "on " + DAY_EN[wd]; return "on " + Number(m[3]) + " " + MON_EN[+m[2] - 1];
  }

  // ---- the words ---------------------------------------------------------------------------------------------
  // English and Maltese. (The Maltese lines want a native speaker's read before they go live: see the report.)
  function words(purpose, v, lang, ph) {
    v = v || {}; var f = v.first || "", P = (ph && ph.name) || (lang === "mt" ? "l-ispiżerija" : "the pharmacy"), tel = (ph && ph.phone) || "";
    var short = function (s, n) { s = str(s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trim() + "…" : s; };
    var it = short(v.items, 60), sign = ph && ph.name ? "\n" + ph.name : ""; // the pharmacy's name signs a message that does not already say it
    if (lang === "mt") {
      var hi = "Bonġu" + (f ? " " + f : "") + ", ";
      if (purpose === "ready") return hi + "l-ordni tiegħek" + (it ? " (" + it + ")" : "") + " hija lesta. Tista' tiġi għaliha għand " + P + "." + (v.code ? " In-numru tal-ordni: " + v.code + "." : "");
      if (purpose === "repeat") return hi + "ir-riċetta tiegħek għal " + short(v.medicine, 60) + " hija dovuta " + dayWords(v.due, "mt") + ". Tridna nlestuhielek? Wieġeb dan il-messaġġ" + (tel ? " jew ċempel " + tel : "") + "." + sign;
      if (purpose === "answer") return hi + "dwar il-mistoqsija tiegħek" + (v.issue ? " (“" + short(v.issue, 70) + "”)" : "") + ": " + str(v.answer) + sign;
      if (purpose === "delivery") return hi + "il-kunsinna tiegħek minn " + P + " ġejja " + dayWords(v.date, "mt") + (v.slot ? " (" + v.slot + ")" : "") + ".";
      if (purpose === "booking") return hi + "infakkruk fl-appuntament tiegħek" + (v.service ? " (" + v.service + ")" : "") + " " + dayWords(v.date, "mt") + (v.time ? " fil-" + v.time : "") + " għand " + P + ". Jekk ma tistax tiġi, għidilna" + (tel ? " fuq " + tel : "") + ".";
      return hi + sign;
    }
    var h = "Hi" + (f ? " " + f : "") + ", ";
    if (purpose === "ready") return h + "your order" + (it ? " (" + it + ")" : "") + " is ready to collect at " + P + "." + (v.code ? " Your order number is " + v.code + "." : "") + " See you soon!";
    if (purpose === "repeat") return h + "your repeat prescription for " + short(v.medicine, 60) + " is due " + dayWords(v.due, "en") + ". Shall we get it ready for you? Just reply to this message" + (tel ? " or call us on " + tel : "") + "." + sign;
    if (purpose === "answer") return h + "about your question" + (v.issue ? " (“" + short(v.issue, 70) + "”)" : "") + ": " + str(v.answer) + sign;
    if (purpose === "delivery") return h + "your delivery from " + P + " is coming " + dayWords(v.date, "en") + (v.slot ? " (" + v.slot.toLowerCase() + ")" : "") + ". Please make sure someone is in.";
    if (purpose === "booking") return h + "a reminder of your " + (v.service ? v.service.toLowerCase() : "appointment") + " at " + P + " " + dayWords(v.date, "en") + (v.time ? " at " + v.time : "") + ". If you can't make it, please let us know" + (tel ? " on " + tel : "") + ".";
    return h + sign;
  }
  var TITLE = { ready: "order ready", repeat: "repeat prescription due", answer: "answer to their question", delivery: "delivery coming", booking: "booking reminder", other: "message" };
  var SUBJECT = { ready: "Your order is ready", repeat: "Your repeat prescription", answer: "About your question", delivery: "Your delivery", booking: "Your booking", other: "A message from the pharmacy" };
  var SUBJECT_MT = { ready: "L-ordni tiegħek hija lesta", repeat: "Ir-riċetta tiegħek", answer: "Dwar il-mistoqsija tiegħek", delivery: "Il-kunsinna tiegħek", booking: "L-appuntament tiegħek", other: "Messaġġ mill-ispiżerija" };
  var CH = { whatsapp: "WhatsApp", sms: "SMS", email: "E-mail" };

  async function getSetup() {
    if (setup && Date.now() - setupAt < 5 * 60000) return setup;
    try { var r = await E.apiFetch("/messages/setup", { method: "GET", timeoutMs: 8000 }); if (r && r.ok) { setup = r; setupAt = Date.now(); } } catch (e) { if (!setup) setup = { email: { ready: false, why: "Could not check e-mail just now." }, pharmacy: {}, failed: true }; }
    return setup || { email: { ready: false, why: "" }, pharmacy: {} };
  }

  function css() {
    if (document.getElementById("eikon-tell-css")) return;
    var st = document.createElement("style"); st.id = "eikon-tell-css";
    st.textContent =
      ".tl-ov{position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:9000;display:flex;align-items:flex-end;justify-content:center}@media (min-width:700px){.tl-ov{align-items:center}}" +
      ".tl{background:var(--panel,#fff);color:var(--text,#111);width:100%;max-width:520px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:20px 20px 16px;box-shadow:0 20px 60px rgba(0,0,0,.35);box-sizing:border-box}@media (min-width:700px){.tl{border-radius:18px}}" +
      ".tl h2{font-size:21px;margin:0 0 2px;letter-spacing:-.02em;font-weight:800}.tl .sub{color:var(--muted);font-size:14px;margin:0 0 14px}" +
      ".tl-ch{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:6px;border:0;padding:0}.tl-ch legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}" +
      ".tl-ch label{position:relative;display:flex;align-items:center;justify-content:center;min-height:48px;border:1px solid var(--border);border-radius:12px;font-weight:700;font-size:15px;cursor:pointer;background:var(--panel2,#f6f6f8);text-align:center;padding:0 6px}" +
      ".tl-ch input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}.tl-ch label.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent) inset;color:var(--accent)}.tl-ch label.off{opacity:.55;cursor:not-allowed}.tl-ch label:focus-within{outline:3px solid var(--accent);outline-offset:2px}" +
      ".tl-why{font-size:13px;color:var(--muted);min-height:18px;margin:2px 0 10px}" +
      ".tl label.f{display:block;font-size:13px;font-weight:700;color:var(--muted);margin:10px 0 4px}.tl input.t,.tl textarea{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;background:var(--bg,#fff);color:var(--text);font-size:16px;padding:10px 12px;font-family:inherit}" +
      ".tl textarea{min-height:150px;resize:vertical;line-height:1.45}.tl input.t:focus,.tl textarea:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px rgba(10,143,106,.2)}" +
      ".tl-lang{display:inline-flex;gap:0;border:1px solid var(--border);border-radius:9px;overflow:hidden;margin-left:auto}.tl-lang button{border:0;background:transparent;color:var(--text);font:inherit;font-size:13px;font-weight:600;padding:0 12px;min-height:34px;cursor:pointer}.tl-lang button[aria-pressed=true]{background:var(--accent);color:#fff}" +
      ".tl-row{display:flex;align-items:center;gap:10px;margin-top:10px}.tl-row label.f{margin:0}.tl-count{font-size:12.5px;color:var(--muted);text-align:right;margin-top:4px}" +
      ".tl-err{background:rgba(191,59,46,.1);border:1px solid rgba(191,59,46,.35);color:var(--danger,#B3261E);border-radius:10px;padding:9px 12px;font-size:14px;margin-top:12px}" +
      ".tl-act{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}.tl-act .tl-b{min-height:48px;padding:0 20px;border-radius:12px;border:1px solid var(--border);background:var(--panel2,#f6f6f8);color:var(--text);font:inherit;font-size:16px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}" +
      ".tl-act .tl-b.p{background:var(--accent);border-color:var(--accent);color:#fff;flex:1;max-width:280px}.tl-act .tl-b[aria-disabled=true],.tl-act .tl-b:disabled{opacity:.55;pointer-events:none}" +
      ".tl-note{font-size:12.5px;color:var(--muted);margin-top:10px;line-height:1.4}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .tl-act .tl-b.p,html[data-ui2]:not([data-ui2-visit]) .tl-lang button[aria-pressed=true]{color:#00160E}}"; // dark text on the light dark-mode green, as every primary button
    document.head.appendChild(st);
  }

  // Which channels can be used for this person, and why not.
  function channels(p, prof, su) {
    var mob = [p.phone, p.alt_phone].filter(isMobile)[0] || "", any = [p.phone, p.alt_phone].filter(function (x) { return intl(x); })[0] || "";
    var no = function (k) { return prof && prof[k] === false; }, nm = firstName(p.name) || "They";
    var out = {
      whatsapp: no("whatsapp_ok") ? { off: nm + " asked not to get WhatsApp messages." } : { to: mob || any, off: "" },
      sms: no("sms_ok") ? { off: nm + " asked not to get text messages." } : { to: mob || any, off: "" },
      email: no("email_ok") ? { off: nm + " asked not to get e-mails." } : prof && prof.opted_out ? { off: "This address stopped e-mails from the pharmacy." } : !(su && su.email && su.email.ready) ? { off: (su && su.email && su.email.why) || "E-mail is not set up here." } : { to: p.email || "", off: "" }
    };
    return out;
  }
  function pick(p, prof, ch) {
    var pref = prof && prof.prefers;
    if (pref && ch[pref] && !ch[pref].off) return pref;
    if (lastChannel && ch[lastChannel] && !ch[lastChannel].off && ch[lastChannel].to) return lastChannel;
    return ["whatsapp", "sms", "email"].filter(function (k) { return !ch[k].off && ch[k].to; })[0] || ["whatsapp", "sms", "email"].filter(function (k) { return !ch[k].off; })[0] || "whatsapp";
  }

  function key() { return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10); }

  // ---- the window --------------------------------------------------------------------------------------------
  async function open(o) {
    o = o || {}; css();
    var p = Object.assign({ id: 0, name: "", phone: "", alt_phone: "", email: "" }, o.person || {}), purpose = TITLE[o.purpose] ? o.purpose : "other";
    var back = o.back || document.activeElement;
    var dk = purpose + "|" + str(o.ref && o.ref.kind) + "|" + str(o.ref && o.ref.id) + "|" + str(p.id || p.name);
    var ov = document.createElement("div"); ov.className = "tl-ov"; ov.setAttribute("data-tell-window", "");
    ov.innerHTML = '<div class="tl" role="dialog" aria-modal="true" aria-labelledby="tl-h"><h2 id="tl-h" tabindex="-1">Tell ' + esc(firstName(p.name) || p.name || "the customer") + '</h2><p class="sub">Getting ready…</p></div>';
    document.body.appendChild(ov);
    var box = ov.querySelector(".tl");
    var closed = false;
    function close(sent) {
      if (closed) return; closed = true; document.removeEventListener("keydown", onKey, true); ov.remove();
      try { if (back && back.isConnected) back.focus(); } catch (e) {}
      if (o.onClose) try { o.onClose(sent); } catch (e) {}
    }
    function onKey(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); keepDraft(); close(false); return; }
      if (ev.key === "Tab") { // focus stays in the window
        var f = Array.prototype.filter.call(box.querySelectorAll("button,a[href],input,textarea,[tabindex='0']"), function (x) { return !x.disabled && x.getAttribute("aria-disabled") !== "true" && x.offsetParent !== null; });
        if (!f.length) return; var a = document.activeElement;
        if (ev.shiftKey && (a === f[0] || !box.contains(a))) { ev.preventDefault(); f[f.length - 1].focus(); }
        else if (!ev.shiftKey && a === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener("keydown", onKey, true);
    ov.addEventListener("mousedown", function (ev) { if (ev.target === ov) { keepDraft(); close(false); } });
    E.focusSoon(function () { return box.querySelector("#tl-h"); });

    // who, how they like to be told, what the pharmacy has set up
    var su = await getSetup(), prof = o.profile || null;
    if (o.email) su = Object.assign({}, su, { email: o.email }); // the record's own, fresher answer
    if (!p.id && E.people && E.people.find && p.name) { try { var f = await E.people.find({ name: p.name, id_card: p.id_card, phone: p.phone, email: p.email }); if (f && f.person) p = Object.assign({}, f.person, { phone: p.phone || f.person.phone, email: p.email || f.person.email });
      // the server's search misses a name with a Maltese capital (Żammit): by the phone, the one card with a name that fits
      else if (p.phone && E.people.namesCompatible) { var bp = await E.apiFetch("/people?q=" + encodeURIComponent(String(p.phone).replace(/\s+/g, "")) + "&limit=20", { method: "GET", timeoutMs: 8000 }); var hit = ((bp && bp.people) || []).filter(function (x) { return !x.merged_into && E.people.namesCompatible(x.name, p.name); }); if (hit.length === 1) p = Object.assign({}, hit[0], { phone: p.phone, email: p.email || hit[0].email }); } } catch (e) {} }
    if (p.id && !prof) { try { var nw = await E.apiFetch("/people/" + p.id + "/now", { method: "GET", timeoutMs: 8000 }); if (nw && nw.ok) { prof = Object.assign({}, nw.profile, { opted_out: nw.email && nw.email.opted_out }); if (nw.email) su = Object.assign({}, su, { email: nw.email }); p = Object.assign({}, nw.person || {}, { phone: p.phone || (nw.person || {}).phone, alt_phone: p.alt_phone || (nw.person || {}).alt_phone, email: p.email || (nw.person || {}).email }); } } catch (e) {} }
    if (closed) return;
    var ph = (su && su.pharmacy) || {}, ch = channels(p, prof, su), v = Object.assign({ first: firstName(p.name) }, o.vars || {});
    var d = drafts[dk] || null;
    var st = { ch: d ? d.ch : pick(p, prof, ch), lang: d ? d.lang : (prof && prof.lang) || "en", text: d ? d.text : "", subj: d ? d.subj : "", to: d ? d.to : {}, edited: d ? d.edited : false, err: "", busy: false, key: d ? d.key : key() };
    function base() { return words(purpose, v, st.lang, ph); }
    if (!st.text) st.text = base();
    if (!st.subj) st.subj = (st.lang === "mt" ? SUBJECT_MT : SUBJECT)[purpose];
    function keepDraft() { var t = box.querySelector("textarea"); if (t) st.text = t.value; if (st.edited || st.text !== base()) drafts[dk] = { ch: st.ch, lang: st.lang, text: st.text, subj: st.subj, to: st.to, edited: true, key: st.key }; }
    function toOf(k) { return st.to[k] != null ? st.to[k] : (ch[k].to || ""); }

    function paint(focusSel) {
      var c = st.ch, off = ch[c].off, to = toOf(c), ok = !off && (c === "email" ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim()) : !!intl(to)) && st.text.trim();
      var href = !off && c !== "email" && intl(to) ? (c === "whatsapp" ? waLink(to, st.text) : smsLink(to, st.text)) : "";
      var label = c === "whatsapp" ? "Open WhatsApp" : c === "sms" ? "Open Messages" : st.busy ? "Sending…" : "Send e-mail";
      var seg = st.text.length <= 160 ? 1 : Math.ceil(st.text.length / 153);
      box.innerHTML = '<h2 id="tl-h" tabindex="-1">Tell ' + esc(firstName(p.name) || p.name || "the customer") + '</h2><p class="sub">' + esc((TITLE[purpose].charAt(0).toUpperCase() + TITLE[purpose].slice(1)) + (o.subtitle ? " · " + o.subtitle : "")) + '</p>' +
        '<fieldset class="tl-ch"><legend>How</legend>' + ["whatsapp", "sms", "email"].map(function (k) {
          return '<label class="' + (k === c ? "on" : "") + (ch[k].off ? " off" : "") + '"><input type="radio" name="tl-ch" value="' + k + '"' + (k === c ? " checked" : "") + (ch[k].off ? ' aria-disabled="true" aria-describedby="tl-why"' : "") + '>' + CH[k] + '</label>'; }).join("") + '</fieldset>' +
        '<div class="tl-why" id="tl-why" aria-live="polite">' + esc(off || (c === "email" ? "Sent now by the pharmacy's e-mail." : "Opens " + CH[c] + " on this device with the message written. You press Send there.")) + '</div>' +
        (off ? "" : '<label class="f" for="tl-to">' + (c === "email" ? "E-mail address" : "Mobile number") + '</label><input class="t" id="tl-to" name="to" value="' + esc(to) + '" autocomplete="off"' + (c === "email" ? ' inputmode="email" autocapitalize="off" spellcheck="false"' : ' inputmode="tel"') + '>') +
        (off || c !== "email" ? "" : '<label class="f" for="tl-subj">Subject</label><input class="t" id="tl-subj" name="subject" value="' + esc(st.subj) + '" autocomplete="off">') +
        '<div class="tl-row"><label class="f" for="tl-text">Message</label><span class="tl-lang" role="group" aria-label="Language"><button type="button" data-lang="en" aria-pressed="' + (st.lang === "en") + '">English</button><button type="button" data-lang="mt" aria-pressed="' + (st.lang === "mt") + '">Malti</button></span></div>' +
        '<textarea id="tl-text" name="message" spellcheck="true">' + esc(st.text) + '</textarea>' +
        (c === "sms" ? '<div class="tl-count">' + st.text.length + " letters" + (seg > 1 ? " · " + seg + " texts" : "") + '</div>' : "") +
        (st.err ? '<div class="tl-err" role="alert">' + esc(st.err) + '</div>' : "") +
        '<div class="tl-act"><button type="button" class="tl-b" data-act="cancel">Cancel</button>' +
        (c === "email" ? '<button type="button" class="tl-b p" data-act="send"' + (ok && !st.busy ? "" : " disabled") + '>' + label + '</button>'
          : '<a class="tl-b p" data-act="open" ' + (ok ? 'href="' + esc(href) + '" target="_blank" rel="noopener"' : 'aria-disabled="true" role="link"') + '>' + label + '</a>') + '</div>' +
        '<div class="tl-note">Saved in ' + esc(firstName(p.name) || "their") + (firstName(p.name) ? "'s" : "") + ' timeline. Nothing is sent by itself.</div>';
      bind();
      if (focusSel) { var el = box.querySelector(focusSel); if (el) try { el.focus(); if (el.setSelectionRange && focusSel === "#tl-text") el.setSelectionRange(el.value.length, el.value.length); } catch (e) {} }
    }
    function refreshAction() { // typing changes only the link and the button, never the field being typed in
      var c = st.ch, a = box.querySelector("[data-act=open],[data-act=send]"), to = toOf(c); if (!a) return;
      var ok = !ch[c].off && (c === "email" ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim()) : !!intl(to)) && st.text.trim();
      if (c === "email") { a.disabled = !ok || st.busy; return; }
      if (ok) { a.setAttribute("href", c === "whatsapp" ? waLink(to, st.text) : smsLink(to, st.text)); a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); a.removeAttribute("aria-disabled"); a.removeAttribute("role"); }
      else { a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); a.setAttribute("role", "link"); }
      var cnt = box.querySelector(".tl-count"); if (cnt) { var sg = st.text.length <= 160 ? 1 : Math.ceil(st.text.length / 153); cnt.textContent = st.text.length + " letters" + (sg > 1 ? " · " + sg + " texts" : ""); }
    }
    function bind() {
      box.querySelectorAll("input[name=tl-ch]").forEach(function (r) {
        r.addEventListener("click", function (ev) { if (r.getAttribute("aria-disabled") === "true") { ev.preventDefault(); var w = box.querySelector("#tl-why"); if (w) w.textContent = ch[r.value].off; } }); // a channel that can't be used says why when it is tapped
        r.addEventListener("change", function () { if (r.getAttribute("aria-disabled") === "true") return; keepText(); st.ch = r.value; st.err = ""; paint("input[name=tl-ch][value=" + r.value + "]"); });
      });
      var t = box.querySelector("#tl-text"); if (t) t.addEventListener("input", function () { st.text = t.value; st.edited = true; refreshAction(); });
      var to = box.querySelector("#tl-to"); if (to) to.addEventListener("input", function () { st.to[st.ch] = to.value; refreshAction(); });
      var sj = box.querySelector("#tl-subj"); if (sj) sj.addEventListener("input", function () { st.subj = sj.value; });
      box.querySelectorAll("[data-lang]").forEach(function (b) { b.addEventListener("click", function () {
        var l = b.getAttribute("data-lang"); if (l === st.lang) return; keepText();
        var wasBase = st.text === words(purpose, v, st.lang, ph), wasSubj = st.subj === (st.lang === "mt" ? SUBJECT_MT : SUBJECT)[purpose];
        st.lang = l; if (wasBase) st.text = base(); if (wasSubj) st.subj = (l === "mt" ? SUBJECT_MT : SUBJECT)[purpose]; // what was typed by hand is never replaced
        paint('[data-lang="' + l + '"]'); }); });
      box.querySelector("[data-act=cancel]").addEventListener("click", function () { keepDraft(); close(false); });
      var op = box.querySelector("[data-act=open]"); if (op) op.addEventListener("click", function (ev) { if (op.getAttribute("aria-disabled") === "true") { ev.preventDefault(); return; } record(); });
      var se = box.querySelector("[data-act=send]"); if (se) se.addEventListener("click", function () { record(); });
      if (t) t.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); var a = box.querySelector("[data-act=open],[data-act=send]"); if (a && !a.disabled && a.getAttribute("aria-disabled") !== "true") a.click(); } });
    }
    function keepText() { var t = box.querySelector("#tl-text"); if (t) st.text = t.value; }

    async function record() {
      if (st.busy) return; keepText();
      var c = st.ch, body = { person_id: p.id || 0, name: p.name || "", channel: c, purpose: purpose, ref_kind: str(o.ref && o.ref.kind), ref_id: Number(o.ref && o.ref.id) || 0,
        to: toOf(c).trim(), subject: c === "email" ? st.subj : "", body: st.text, client_key: st.key };
      st.busy = true; st.err = ""; if (c === "email") paint();
      lastChannel = c;
      try {
        var r = await E.apiFetch("/messages", { method: "POST", body: JSON.stringify(body), timeoutMs: 20000 });
        if (!r || !r.ok) throw new Error((r && r.error) || "Not saved");
        delete drafts[dk];
        E.toast(c === "email" ? "E-mail sent to " + body.to : CH[c] + " opened. Saved in " + (firstName(p.name) || "their") + (firstName(p.name) ? "'s" : "") + " timeline.", "success");
        close(true); if (o.onSent) try { o.onSent(r.message); } catch (e) {}
      } catch (x) {
        st.busy = false;
        var j = x && x.bodyJson, why = (j && j.error) || (x && x.network ? "No connection" : String((x && x.message) || x));
        if (c === "email") { st.err = x && x.network ? "We could not tell if the e-mail went. Check the timeline before sending again." : why.replace(/^Not sent: /, "Not sent: "); if (!/^Not sent/.test(st.err) && !(x && x.network)) st.err = "Not sent: " + why; }
        else st.err = CH[c] + " was opened, but it is not in the timeline yet (" + why + "). Press it again to save it: the same message is not saved twice.";
        drafts[dk] = { ch: st.ch, lang: st.lang, text: st.text, subj: st.subj, to: st.to, edited: true, key: st.key };
        paint(c === "email" ? "#tl-text" : null);
      }
    }
    paint();
    // An answer not written yet: the cursor waits where it goes ("…your question (…): |"). Otherwise the one button.
    var gap = purpose === "answer" && !str(v.answer).trim() ? st.text.indexOf("): ") : -1;
    if (gap >= 0) setTimeout(function () { var t = box.querySelector("#tl-text"); if (t && E.focusIfIdle(t, Date.now() - 1, document.activeElement)) try { t.setSelectionRange(gap + 3, gap + 3); } catch (e) {} }, 0);
    else E.focusSoon(function () { var a = box.querySelector("[data-act=open]:not([aria-disabled=true]),[data-act=send]:not([disabled])"); return a || box.querySelector("#tl-to") || box.querySelector("#tl-text"); });
    return { close: close };
  }

  E.tell = { open: open, words: words, firstName: firstName, intl: intl, isMobile: isMobile, waLink: waLink, smsLink: smsLink, dayWords: dayWords, _reset: function () { setup = null; drafts = {}; lastChannel = ""; } };
})();
