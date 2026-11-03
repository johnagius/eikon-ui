/* ============================================================
   EIKON — Possible duplicates  (modules.dupreg.js), new layout, under Customers
   People who are probably the same person but were written down differently in
   different sections. Every row comes from an existing GET route, scoped by the
   server to the signed-in pharmacy. No record is ever changed from here.
   - "Same person — link" (only when E.FEATURES.peopleLinks is on, OFF by default until the
     owner approves it, and the server has POST /people/links) records that
     the group's records are one person in the server's insert-only people_links
     table; "Undo" takes the link out of force. Linked records count as one client,
     so a fully linked group leaves the list and shows under "Linked as one person".
   - Grouped by: the same ID card (upper case, no spaces, Maltese 7-digit padding as
     normalizeMtIdCard in the worker), the same phone number (digits only, +356/00356
     dropped), or the same name and date of birth.
   - Never grouped: two different ID cards, or two different dates of birth, however
     the rest matches (a family can share a phone; two people can share a name).
   - Shown only when the group would appear as more than one client (the server's
     own person key: ID card, otherwise name), or its ID card is written two ways.
   - "Not the same person" hides a group on this device only (localStorage, per
     pharmacy, a hash of the group: no names or ID cards are stored).
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;
  E.FEATURES = E.FEATURES || {};
  if (E.FEATURES.peopleLinks === undefined) E.FEATURES.peopleLinks = false; // not approved yet: see readLinks

  var S = { mount: null, loading: false, done: 0, total: 0, records: [], failed: [], groups: null, showHidden: false, undo: null, seq: 0, err: "",
    canLink: false, links: [], showLinked: false, linkUndo: null, busy: false };

  // ---------- normalising (pure; also exposed as E.dupes for tests) ----------
  function str(v) { return v == null ? "" : String(v); }
  // As normalizeMtIdCard in the worker: no spaces, upper case, 1–7 digits + a letter padded to 7 digits.
  function normId(raw) {
    var s = str(raw).replace(/\s+/g, "").toUpperCase();
    if (!s) return "";
    var m = /^(\d{1,7})([A-Z])$/.exec(s);
    return m ? ("0000000" + m[1]).slice(-7) + m[2] : s;
  }
  // Only something that can be an ID card links people: a digit in it, four characters or more, not all zeros.
  function idKey(raw) {
    var n = normId(raw);
    if (n.length < 4 || !/\d/.test(n) || /^0+[A-Z]?$/.test(n)) return "";
    return n;
  }
  function phoneKey(raw) {
    var d = str(raw).replace(/\D+/g, "");
    if (d.indexOf("00") === 0) d = d.slice(2);
    if (d.length === 11 && d.indexOf("356") === 0) d = d.slice(3);
    if (d.length < 7 || /^(\d)\1+$/.test(d)) return "";
    return d;
  }
  // Name for the name + date of birth rule: no accents, no punctuation, word order ignored ("Borg Rita" = "Rita Borg").
  function nameKey(raw) {
    var s = str(raw);
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    s = s.toLowerCase().replace(/[^a-zÀ-ɏħ]+/g, " ").trim();
    if (!s) return "";
    return s.split(/\s+/).sort().join(" ");
  }
  function dobKey(raw) { var s = str(raw).trim().slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ""; }
  // The server's own key for one client (personKey in the worker): the ID card, otherwise the name.
  function clientKey(idRaw, name) {
    var i = normId(idRaw);
    if (i) return "id:" + i;
    var n = str(name).trim().toLowerCase().replace(/\s+/g, " ");
    return n ? "name:" + n : "";
  }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36) + s.length.toString(36); }

  // records: [{ uid, kind, name, idRaw, phones:[], dob, date, people_id? }] -> groups
  function group(records) {
    var parent = {}, attr = {};
    records.forEach(function (r) {
      parent[r.uid] = r.uid;
      r._id = idKey(r.idRaw); r._dob = dobKey(r.dob); r._name = nameKey(r.name);
      r._phones = []; r._phoneRaw = {};
      (r.phones || []).forEach(function (p) { var k = phoneKey(p); if (k && r._phones.indexOf(k) < 0) { r._phones.push(k); r._phoneRaw[k] = str(p).trim(); } });
      attr[r.uid] = { ids: r._id ? [r._id] : [], dobs: r._dob ? [r._dob] : [] };
    });
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function clash(a, b) { // two different ID cards, or two different dates of birth, never meet
      var A = attr[a], B = attr[b];
      if (A.ids.length && B.ids.length && A.ids[0] !== B.ids[0]) return true;
      if (A.dobs.length && B.dobs.length && A.dobs[0] !== B.dobs[0]) return true;
      return false;
    }
    function union(a, b) {
      a = find(a); b = find(b); if (a === b) return true;
      if (clash(a, b)) return false;
      parent[b] = a;
      if (!attr[a].ids.length) attr[a].ids = attr[b].ids;
      if (!attr[a].dobs.length) attr[a].dobs = attr[b].dobs;
      return true;
    }
    function buckets(fn) { var m = {}; records.forEach(function (r) { fn(r).forEach(function (k) { (m[k] = m[k] || []).push(r); }); }); return m; }
    // A key that would join two different ID cards (or dates of birth) says nothing about who is who: it links no one.
    function ambiguous(list) {
      var ids = {}, dobs = {};
      list.forEach(function (r) { var a = attr[find(r.uid)]; if (a.ids[0]) ids[a.ids[0]] = 1; if (a.dobs[0]) dobs[a.dobs[0]] = 1; });
      return Object.keys(ids).length > 1 || Object.keys(dobs).length > 1;
    }
    // Records the pharmacy linked as one person (people_links, r.link) are one person, whatever else they say.
    var byLink = buckets(function (r) { return r.link ? [r.link] : []; });
    Object.keys(byLink).forEach(function (k) { var l = byLink[k]; for (var i = 1; i < l.length; i++) { var a = find(l[0].uid), b = find(l[i].uid); if (a !== b) parent[b] = a; } });
    var used = { id: {}, dob: {}, phone: {} }, skipped = { phone: {}, dob: {} };
    var byId = buckets(function (r) { return r._id ? [r._id] : []; });
    Object.keys(byId).forEach(function (k) { var l = byId[k]; for (var i = 1; i < l.length; i++) union(l[0].uid, l[i].uid); });
    var byDob = buckets(function (r) { return r._dob && r._name && r._name.indexOf(" ") > 0 ? [r._name + "|" + r._dob] : []; });
    Object.keys(byDob).forEach(function (k) { var l = byDob[k]; if (l.length < 2) return; if (ambiguous(l)) { skipped.dob[k] = 1; return; } for (var i = 1; i < l.length; i++) union(l[0].uid, l[i].uid); });
    var byPhone = buckets(function (r) { return r._phones; });
    Object.keys(byPhone).forEach(function (k) { var l = byPhone[k]; if (l.length < 2) return; if (ambiguous(l)) { skipped.phone[k] = 1; return; } for (var i = 1; i < l.length; i++) union(l[0].uid, l[i].uid); });

    // Customers rows own the history that carries their ID card or their name (as GET /people does).
    var own = {};
    records.forEach(function (r) { if (r.kind !== "people") return; var me = r.link ? "l:" + r.link : "p:" + r.people_id; if (normId(r.idRaw)) own["id:" + normId(r.idRaw)] = me; own[clientKey("", r.name)] = me; });
    var comps = {};
    records.forEach(function (r) { var root = find(r.uid); (comps[root] = comps[root] || []).push(r); });
    var out = [];
    Object.keys(comps).forEach(function (root) {
      var list = comps[root]; if (list.length < 2) return;
      var keys = {}, written = {};
      list.forEach(function (r) {
        var k = r.link ? "l:" + r.link : r.kind === "people" ? "p:" + r.people_id : clientKey(r.idRaw, r.name);
        if (!r.link && r.kind !== "people" && own[k]) k = own[k];
        r._client = k; if (k) keys[k] = 1;
        var w = str(r.idRaw).replace(/\s+/g, "").toUpperCase(); if (w && r._id) written[w] = 1;
      });
      var nk = Object.keys(keys).length, nw = Object.keys(written).length;
      var linked = list[0].link && list.every(function (r) { return r.link === list[0].link; }) ? list[0].link : "";
      if (!linked && nk < 2 && nw < 2) return;
      // why: each key shared by records that would otherwise be separate clients
      var why = [];
      function reason(type, valueOf) {
        var seen = {};
        list.forEach(function (r) { valueOf(r).forEach(function (v) { (seen[v] = seen[v] || []).push(r); }); });
        Object.keys(seen).forEach(function (v) {
          var rs = seen[v], ck = {}, ws = {};
          rs.forEach(function (r) { ck[r._client] = 1; ws[type === "id" ? str(r.idRaw).replace(/\s+/g, "").toUpperCase() : type === "phone" ? r._phoneRaw[v] : str(r.name).trim()] = 1; });
          if (rs.length > 1 && (Object.keys(ck).length > 1 || (type === "id" && Object.keys(ws).length > 1))) why.push({ type: type, value: v, written: Object.keys(ws), count: rs.length });
        });
      }
      reason("id", function (r) { return r._id ? [r._id] : []; });
      reason("phone", function (r) { return r._phones; });
      reason("dob", function (r) { return r._dob && r._name && r._name.indexOf(" ") > 0 && !skipped.dob[r._name + "|" + r._dob] ? [r._name + "|" + r._dob] : []; });
      var fp = Object.keys(keys).concat(Object.keys(written).map(function (w) { return "w:" + w; })).sort().join("|");
      var latest = list.reduce(function (m, r) { return str(r.date) > m ? str(r.date) : m; }, "");
      out.push({ id: hash(fp), records: list, keys: nk, why: why, latest: latest, name: bestName(list), idCard: (attr[root].ids[0] || ""), sections: uniq(list.map(function (r) { return r.kind; })).length, linked: linked });
    });
    out.sort(function (a, b) { return b.keys - a.keys || (b.latest > a.latest ? 1 : b.latest < a.latest ? -1 : 0) || a.name.localeCompare(b.name); });
    return out;
  }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function bestName(list) {
    var p = list.filter(function (r) { return r.kind === "people"; })[0]; if (p) return str(p.name).trim();
    var n = {}; list.forEach(function (r) { var k = str(r.name).trim().replace(/\s+/g, " "); if (k) n[k] = (n[k] || 0) + 1; });
    return Object.keys(n).sort(function (a, b) { return n[b] - n[a] || b.length - a.length; })[0] || "Unnamed";
  }

  E.dupes = { normId: normId, idKey: idKey, phoneKey: phoneKey, nameKey: nameKey, clientKey: clientKey, group: group };

  // ---------- where the rows come from: only existing read routes ----------
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }
  function months(n) { var out = [], d = new Date(); d.setDate(1); for (var i = 0; i < n; i++) { out.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")); d.setMonth(d.getMonth() - 1); } return out; }
  var MONTHS = 12;
  function SOURCES() {
    var today = addDays(0); // month by month: the live worker does not take from/to ranges on every register
    return [
      { kind: "people", label: "Customer card", reg: "customers", urls: ["/people?limit=50"], rows: function (r) { return (r.people || []).map(function (x) { return { rid: x.id, people_id: x.id, name: x.name, idRaw: x.id_card, phones: [x.phone, x.alt_phone], dob: x.date_of_birth, date: str(x.updated_at).slice(0, 10), detail: x.source && str(x.source).indexOf("history") === 0 ? "Added from the registers" : "Added by hand" }; }); } },
      { kind: "order", label: "Order", reg: "clientorders", urls: months(MONTHS).map(function (m) { return "/client-orders/entries?month=" + m; }), rows: function (r) { return (r.entries || []).map(function (x) { return { rid: x.id, name: x.client_name, phones: [x.client_phone, x.client_alt_phone], date: x.order_date, detail: x.items_text, ref: x.order_code }; }); } },
      { kind: "question", label: "Question", reg: "tickets", urls: ["/client-tickets/entries"], rows: function (r) { return (r.entries || []).map(function (x) { return { rid: x.id, name: x.client_name, phones: [x.phone], date: x.open_date, detail: x.issue, ref: x.ticket_id }; }); } },
      { kind: "delivery", label: "Delivery", reg: "deliveries", urls: ["/client-deliveries/entries"], rows: function (r) { return (r.entries || []).map(function (x) { return { rid: x.id, name: x.client_name, phones: [x.phone], date: x.order_date, detail: x.items || x.delivery_address, ref: x.delivery_id }; }); } },
      { kind: "dda_sale", label: "DDA sale", reg: "dda-sales", urls: months(MONTHS).map(function (m) { return "/dda-sales/entries?month=" + m; }), rows: function (r) { return (r.entries || []).map(function (x) { return { rid: x.id, name: x.client_name, idRaw: x.client_id_card, date: x.entry_date, detail: x.medicine_name_dose, ref: x.prescription_serial_no }; }); } },
      { kind: "poyc", label: "POYC", reg: "dda-poyc", urls: months(MONTHS).map(function (m) { return "/dda-poyc/entries?month=" + m; }), rows: function (r) { return (r.entries || []).map(function (x) { return { rid: x.id, name: x.client_name, idRaw: x.client_id_card, date: x.entry_date, detail: x.medicine_name_dose, ref: x.prescription_serial_no }; }); } },
      { kind: "repeat", label: "Repeat prescription", reg: "repeatprescriptions", urls: months(MONTHS).map(function (m) { return "/repeat-prescriptions/entries?month=" + m; }), rows: function (r) { return (r.entries || []).map(function (x) { return { rid: x.id, name: x.client_name, idRaw: x.client_id, date: x.entry_date, detail: x.medicine_name_dose }; }); } },
      { kind: "appointment", label: "Appointment", reg: "appointments", urls: ["/appointments/entries?limit=5000"], rows: function (r) { return (r.appointments || []).map(function (x) { return { rid: x.id, name: x.patientName, idRaw: x.patientIdCard, phones: [x.patientPhone], date: x.date, detail: x.time ? "At " + x.time : "", ref: x.apptRef }; }); } },
      { kind: "waitlist", label: "Waiting list", reg: "appointments", urls: ["/appointments/waitlist"], rows: function (r) { return (r.waitlist || []).map(function (x) { return { rid: x.id, name: x.patientName, idRaw: x.patientIdCard, phones: [x.patientPhone], date: x.addedDate || str(x.createdAt).slice(0, 10), ref: x.wlRef }; }); } },
      { kind: "booking", label: "Booking", reg: "bookings", urls: ["/bookings?from=" + addDays(-61) + "&to=" + today, "/bookings?from=" + addDays(1) + "&to=" + addDays(62)], rows: function (r) { return (r.bookings || []).map(function (x) { return { rid: x.id, name: x.personName, idRaw: x.personIdCard, phones: [x.personPhone], date: x.date, detail: x.start ? "At " + x.start : "", ref: x.ref }; }); } },
      { kind: "loyalty", label: "Loyalty card", reg: "loyalty", urls: ["/loyalty/clients"], rows: function (r) { return (r.clients || []).map(function (x) { return { rid: x.id, name: x.name, idRaw: x.id_card, date: str(x.created_at).slice(0, 10) }; }); } },
      { kind: "poct", label: "POCT", reg: "poct", urls: ["/poct/state?part=patients"], rows: function (r) { return (r.patients || (r.state && r.state.patients) || []).map(function (x) { return { rid: x.patientId, name: x.name, idRaw: x.patientId, phones: [x.phone], date: str(x.lastSeenIso).slice(0, 10) }; }); } },
      { kind: "screening", label: "Screening", reg: "screening", urls: ["/screening/state"], rows: function (r) { var o = []; (r.campaigns || []).forEach(function (c) { (c.participants || []).forEach(function (x) { o.push({ rid: c.id + "/" + x.id, name: x.name, idRaw: x.idCard, phones: [x.phone], dob: x.dob, date: x.date, detail: c.name }); }); }); return o; } },
      { kind: "calculator", label: "Calculator", reg: "pharmacycalc", urls: ["/pharmacy-calc/patients"], rows: function (r) { return (r.patients || []).map(function (x) { return { rid: x.id, name: x.patient_name, idRaw: x.id_card, date: str(x.start_date || x.created_at).slice(0, 10), detail: x.calc_type }; }); } },
      { kind: "vaccine", label: "Vaccine order", reg: "vaccines", urls: ["/vaccines/orders"], rows: function (r) { return (r.orders || []).map(function (x) { return { rid: x.id, name: (str(x.client_first) + " " + str(x.client_last)).trim(), phones: [x.phone], date: str(x.created_at).slice(0, 10), detail: x.country_name }; }); } },
      { kind: "contact", label: "Contacts", reg: "contacts", urls: ["/contacts/clients"], rows: function (r) { return (r.rows || []).map(function (x) { return { rid: x.id, name: x.name, idRaw: x.id_card, phones: [x.phone, x.alt_phone], date: str(x.updated_at).slice(0, 10) }; }); } }
    ];
  }
  var LABEL = {}; SOURCES().forEach(function (s) { LABEL[s.kind] = s; });

  async function load() {
    var my = ++S.seq;
    var srcs = SOURCES(), jobs = [];
    srcs.forEach(function (s) { s.urls.forEach(function (u) { jobs.push({ s: s, u: u }); }); });
    S.loading = true; S.done = 0; S.total = jobs.length; S.failed = []; S.records = []; S.groups = null; S.err = ""; paint();
    var recs = [], failed = {}, next = 0;
    async function worker() {
      while (next < jobs.length) {
        var j = jobs[next++];
        try {
          var r = await E.apiFetch(j.u, { method: "GET", timeoutMs: 15000 });
          if (my !== S.seq) return;
          if (!r || r.ok === false) throw new Error((r && r.error) || "not read");
          j.s.rows(r).forEach(function (x) { if (!str(x.name).trim() && !x.idRaw && !(x.phones || []).filter(Boolean).length) return; x.kind = j.s.kind; x.uid = j.s.kind + ":" + x.rid; recs.push(x); });
        } catch (e) { failed[j.s.label] = 1; }
        if (my !== S.seq) return;
        S.done++; paintProgress();
      }
    }
    var pool = []; for (var i = 0; i < 5; i++) pool.push(worker());
    await Promise.all(pool);
    if (my !== S.seq) return;
    // the same row can arrive twice (two month pages never overlap, but be safe)
    var seen = {}; recs = recs.filter(function (r) { if (seen[r.uid]) return false; seen[r.uid] = 1; return true; });
    S.records = recs; S.failed = Object.keys(failed);
    await readLinks(my);
    if (my !== S.seq) return;
    regroup();
    S.loading = false;
    paint();
  }

  // ---------- links: GET/POST /people/links (a server without them: no Link button, the view as before) ----------
  // Off until the owner approves "Same person — link": E.FEATURES.peopleLinks (default false). Off, this screen
  // never asks for /people/links, shows no Link button and groups exactly as before. The server routes are inert.
  function linksOn() { return !!(E.FEATURES && E.FEATURES.peopleLinks); }
  async function readLinks(my) {
    if (!linksOn()) { S.canLink = false; S.links = []; return; }
    try {
      var r = await E.apiFetch("/people/links", { method: "GET", timeoutMs: 15000 });
      if (my !== undefined && my !== S.seq) return;
      if (r && r.ok !== false && Array.isArray(r.links)) { S.canLink = true; S.links = r.links; } else { S.canLink = false; S.links = []; }
    } catch (e) { S.canLink = false; S.links = []; }
  }
  function regroup() {
    var of = {};
    S.links.forEach(function (l) { of[l.kind + ":" + l.source_id] = l.link_group; });
    S.records.forEach(function (r) { r.link = of[r.kind + ":" + str(r.rid)] || ""; });
    try { S.groups = group(S.records); } catch (e) { S.groups = []; S.err = "Could not compare the records."; }
  }
  function linkIdsOf(groupId) { return S.links.filter(function (l) { return l.link_group === groupId; }).map(function (l) { return l.id; }); }
  function errText(e, fallback) { var j = e && e.bodyJson; return (j && j.error) || (e && e.message && !/^HTTP /.test(e.message) ? e.message : fallback); }
  // The server takes 50 records a call; a bigger group goes in parts that share a record, so they land in one group.
  async function linkGroup(g) {
    var recs = [], seen = {};
    g.records.forEach(function (r) { var k = r.kind + ":" + str(r.rid); if (!seen[k]) { seen[k] = 1; recs.push({ kind: r.kind, id: str(r.rid) }); } });
    var ids = [], groupId = "", i = 0;
    try {
      while (i < recs.length) {
        var part = i === 0 ? recs.slice(0, 50) : [recs[0]].concat(recs.slice(i, i + 49));
        var r = await E.apiFetch("/people/links", { method: "POST", body: JSON.stringify({ records: part }), timeoutMs: 15000 });
        (r.link_ids || []).forEach(function (x) { ids.push(x); });
        groupId = r.link_group || groupId;
        i += i === 0 ? 50 : 49;
      }
      return { ids: ids, group: groupId };
    } catch (e) {
      if (ids.length) { try { await E.apiFetch("/people/links/undo", { method: "POST", body: JSON.stringify({ link_ids: ids }), timeoutMs: 15000 }); } catch (e2) {} }
      throw e;
    }
  }
  async function doLink(id) {
    var g = groupById(id); if (!g || S.busy) return;
    S.busy = true; paint();
    try {
      var res = await linkGroup(g);
      S.linkUndo = { ids: res.ids, name: g.name, group: res.group, gid: id };
      await readLinks(); regroup(); S.busy = false;
      paint('[data-act="unlink-last"]');
      E.toast(g.name + ": linked as one person", "success");
    } catch (e) {
      S.busy = false; paint('[data-link="' + id + '"]');
      E.toast(errText(e, "Could not link these records. Nothing was linked."), "warn");
    }
  }
  async function doUnlink(ids, name, focusSel) {
    if (!ids.length || S.busy) return;
    S.busy = true; paint();
    try {
      await E.apiFetch("/people/links/undo", { method: "POST", body: JSON.stringify({ link_ids: ids }), timeoutMs: 15000 });
      S.linkUndo = null; await readLinks(); regroup(); S.busy = false;
      paint(focusSel);
      E.toast((name ? name + ": " : "") + "link undone", "success");
    } catch (e) {
      S.busy = false; paint();
      E.toast(errText(e, "Could not undo the link."), "warn");
    }
  }

  // ---------- "Not the same person": per device, per pharmacy ----------
  function storeKey() { var u = E.state && E.state.user || {}; return "eikon_dupes_hidden_v1:" + str(u.org_id) + ":" + str(u.location_id); }
  function hidden() { try { var v = JSON.parse(localStorage.getItem(storeKey()) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function setHidden(list) { try { localStorage.setItem(storeKey(), JSON.stringify(list)); return true; } catch (e) { return false; } }

  // ---------- render ----------
  function esc(s) { return E.escapeHtml(str(s)); }
  function when(d) {
    if (!d) return "";
    var t = ymd(new Date()); if (d === t) return "today";
    var x = new Date(d + "T12:00:00"); if (!isFinite(x.getTime())) return d;
    return x.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + (x.getFullYear() !== new Date().getFullYear() ? " " + x.getFullYear() : "");
  }
  function dobWords(d) { var x = new Date(d + "T12:00:00"); return isFinite(x.getTime()) ? x.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : d; }

  function css() {
    if (document.getElementById("eikon-dupreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-dupreg-css";
    st.textContent =
      ".dup{max-width:880px;margin:0 auto}@media (max-width:600px){.dup{padding:0 16px}}" +
      ".dup-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".dup :focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:8px}" +
      ".dup h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800;overflow-wrap:anywhere}" +
      ".dup-sub{color:var(--muted);font-size:14.5px;line-height:1.45;margin:6px 0 0;max-width:640px}" +
      ".dup-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}.dup-top>div{min-width:0;flex:1 1 260px}" +
      ".dup-btn{font:inherit;font-size:14px;font-weight:600;min-height:34px;padding:6px 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".dup-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".dup-btn:disabled{opacity:.55;cursor:default}.dup-link{border:0;background:none;padding:4px 2px;font:inherit;font-size:13.5px;font-weight:600;color:var(--accent);cursor:pointer;white-space:nowrap}" +
      ".dup-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:22px 2px 8px}" +
      ".dup-note{color:var(--muted);font-size:13px;line-height:1.5;margin:14px 2px 0}" +
      ".dup-quiet{border:1px dashed var(--border);border-radius:12px;padding:22px;color:var(--muted);font-size:14px;line-height:1.5;background:var(--panel2);margin-top:18px}" +
      ".dup-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:10px 14px;margin-top:16px;font-size:14px}" +
      ".dup-card{background:var(--panel2);border:1px solid var(--border);border-radius:14px;margin-top:12px;overflow:hidden}" +
      ".dup-head{padding:14px 16px 10px}.dup-head h2{font-size:18px;font-weight:700;letter-spacing:-.015em;margin:0;overflow-wrap:anywhere}.dup-head p{margin:3px 0 0;color:var(--muted);font-size:13px}" +
      ".dup-why{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}.dup-why li{font-size:13.5px;line-height:1.4;overflow-wrap:anywhere}.dup-why b{font-weight:600}.dup-why span{color:var(--muted)}" +
      ".dup-recs{list-style:none;margin:0;padding:0;border-top:1px solid var(--border)}" +
      ".dup-rec{display:flex;gap:10px;align-items:flex-start;padding:10px 16px;border-top:.5px solid var(--border)}.dup-recs>.dup-rec:first-child{border-top:0}" +
      ".dup-rec .t{flex:1;min-width:0}.dup-rec .s{font-size:12px;font-weight:600;color:var(--muted)}.dup-rec b{display:block;font-size:14.5px;font-weight:600;overflow-wrap:anywhere;margin-top:1px}" +
      ".dup-rec .d{display:block;font-size:12.5px;color:var(--muted);overflow-wrap:anywhere;margin-top:1px}" +
      ".dup-acts{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;padding:10px 16px;border-top:1px solid var(--border)}" +
      ".dup-prog{height:3px;border-radius:2px;background:rgba(118,118,128,.18);overflow:hidden;margin-top:16px}.dup-prog i{display:block;height:100%;background:var(--accent);transition:width .2s}" +
      ".dup-warn{background:rgba(201,138,18,.14);border:1px solid rgba(201,138,18,.35);color:var(--text);border-radius:10px;padding:8px 12px;font-size:13px;margin-top:14px}";
    document.head.appendChild(st);
  }

  function whyLine(w) {
    if (w.type === "id") return "<li><b>Same ID card " + esc(w.value) + "</b>" + (w.written.length > 1 ? " <span>· written " + esc(w.written.join(", ")) + "</span>" : "") + "</li>";
    if (w.type === "phone") return "<li><b>Same phone " + esc(w.value) + "</b>" + (w.written.length > 1 || w.written[0] !== w.value ? " <span>· written " + esc(w.written.join(", ")) + "</span>" : "") + "</li>";
    var dob = w.value.split("|")[1];
    return "<li><b>Same name and date of birth</b> <span>· " + esc(w.written.join(", ")) + ", born " + esc(dobWords(dob)) + "</span></li>";
  }
  // Rows that say the same thing (same section, same name, ID card and phone as written) show once, with a count.
  function lines(g) {
    var m = {}, order = [];
    g.records.forEach(function (r) {
      var k = [r.kind, str(r.name).trim(), str(r.idRaw).trim(), (r.phones || []).filter(Boolean).join("/")].join("|");
      if (!m[k]) { m[k] = { r: r, n: 0, latest: "" }; order.push(k); }
      m[k].n++; if (str(r.date) >= m[k].latest) { m[k].latest = str(r.date); m[k].r = r; }
    });
    return order.map(function (k) { return m[k]; }).sort(function (a, b) { return a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0; });
  }
  function card(g, isHidden, isLinked) {
    var ls = lines(g);
    var h = '<section class="dup-card" data-group="' + esc(g.id) + '" aria-labelledby="dup-h-' + esc(g.id) + '"><div class="dup-head"><h2 id="dup-h-' + esc(g.id) + '">' + esc(g.name) + "</h2>" +
      "<p>" + g.records.length + (g.records.length === 1 ? " record" : " records") + " in " + g.sections + (g.sections === 1 ? " section" : " sections") + (isLinked ? " · linked as one person" : g.keys > 1 ? " · shown as " + g.keys + " clients" : " · ID card written more than one way") + "</p>" +
      '<ul class="dup-why" aria-label="Why these were grouped">' + g.why.map(whyLine).join("") + "</ul></div>";
    h += '<ul class="dup-recs">' + ls.map(function (l) {
      var r = l.r, src = LABEL[r.kind] || { label: r.kind };
      var who = [str(r.name).trim() || "No name", str(r.idRaw).trim(), (r.phones || []).filter(Boolean).join(", ")].filter(Boolean).join(" · ");
      var det = [r.ref, r.detail, r.dob ? "born " + dobWords(r.dob) : ""].filter(Boolean).join(" · ");
      return '<li class="dup-rec"><div class="t"><span class="s">' + esc(src.label) + (l.latest ? " · " + esc(when(l.latest)) : "") + (l.n > 1 ? " · " + l.n + " records" : "") + "</span><b>" + esc(who) + "</b>" + (det ? '<span class="d">' + esc(det.slice(0, 160)) + "</span>" : "") + "</div>" +
        '<button type="button" class="dup-link" data-open="' + esc(r.kind) + '" data-uid="' + esc(r.uid) + '" aria-label="Open ' + esc(src.label) + " for " + esc(str(r.name).trim() || "this record") + '">Open</button></li>';
    }).join("") + "</ul>";
    var dis = S.busy ? " disabled" : "";
    if (isLinked) h += '<div class="dup-acts"><button type="button" class="dup-btn" data-unlink="' + esc(g.linked) + '" aria-label="Undo the link: ' + esc(g.name) + '"' + dis + ">Undo link</button></div></section>";
    else h += '<div class="dup-acts">' + (isHidden ? '<button type="button" class="dup-btn" data-show="' + esc(g.id) + '">Show again</button>' : (S.canLink ? '<button type="button" class="dup-btn p" data-link="' + esc(g.id) + '" aria-label="Same person — link: ' + esc(g.name) + '"' + dis + ">Same person — link</button>" : "") + '<button type="button" class="dup-btn" data-hide="' + esc(g.id) + '" aria-label="Not the same person: ' + esc(g.name) + '">Not the same person</button>') + "</div></section>";
    return h;
  }

  function paintProgress() {
    var m = S.mount; if (!m) return;
    var i = m.querySelector(".dup-prog i"), t = m.querySelector("#dup-status");
    if (i) i.style.width = Math.round(100 * S.done / Math.max(1, S.total)) + "%";
    if (t) t.textContent = "Checking the registers… " + S.done + " of " + S.total;
  }

  function paint(focusSel) {
    if (E.state.activeModuleId !== "dupreg") return;
    var m = S.mount; if (!m) return;
    var h = '<div class="dup"><button type="button" class="dup-back" data-act="back">‹ Customers</button>' +
      '<div class="dup-top"><div><h1>Possible duplicates</h1><p class="dup-sub">People who look like the same person but were written down differently in different sections. Nothing here changes a record.</p></div>' +
      '<button type="button" class="dup-btn" data-act="reload"' + (S.loading ? " disabled" : "") + ">Check again</button></div>";
    if (S.loading) {
      h += '<div class="dup-prog" aria-hidden="true"><i style="width:' + Math.round(100 * S.done / Math.max(1, S.total)) + '%"></i></div><p class="dup-note" id="dup-status" role="status">Checking the registers… ' + S.done + " of " + S.total + "</p>";
    } else if (S.groups) {
      var hid = hidden(), linkedGs = S.groups.filter(function (g) { return g.linked; }), open = S.groups.filter(function (g) { return !g.linked; });
      var shown = open.filter(function (g) { return hid.indexOf(g.id) < 0; }), gone = open.filter(function (g) { return hid.indexOf(g.id) >= 0; });
      if (S.linkUndo) h += '<div class="dup-bar" role="status"><span>' + esc(S.linkUndo.name) + " linked as one person. No record was changed.</span><button type=\"button\" class=\"dup-link\" data-act=\"unlink-last\"" + (S.busy ? " disabled" : "") + ">Undo</button></div>";
      if (S.undo) h += '<div class="dup-bar" role="status"><span>' + esc(S.undo.name) + " marked as not the same person.</span><button type=\"button\" class=\"dup-link\" data-act=\"undo\">Undo</button></div>";
      if (S.err) h += '<div class="dup-warn" role="alert">' + esc(S.err) + "</div>";
      if (S.failed.length) h += '<div class="dup-warn">Could not read ' + esc(S.failed.join(", ")) + ". The list below leaves them out. Check again later.</div>";
      h += '<div class="dup-lab" id="dup-count" role="status">' + (shown.length ? shown.length + (shown.length === 1 ? " possible duplicate" : " possible duplicates") : "No possible duplicates") + "</div>";
      if (!shown.length) h += '<div class="dup-quiet">' + (S.records.length ? "Every person here is recorded one way, or the records that look alike have different ID cards or dates of birth." : "There is nothing in the registers yet.") + "</div>";
      h += shown.slice(0, S.limit || 40).map(function (g) { return card(g, false); }).join("");
      if (shown.length > (S.limit || 40)) h += '<div style="text-align:center;margin-top:14px"><button type="button" class="dup-btn" data-act="more">Show ' + Math.min(40, shown.length - (S.limit || 40)) + " more</button></div>";
      if (linkedGs.length) {
        h += '<div class="dup-lab">Linked as one person · ' + linkedGs.length + '</div><button type="button" class="dup-link" data-act="toggle-linked" aria-expanded="' + (S.showLinked ? "true" : "false") + '">' + (S.showLinked ? "Hide these" : "Show these") + "</button>";
        if (S.showLinked) h += linkedGs.map(function (g) { return card(g, false, true); }).join("");
      }
      if (gone.length) {
        h += '<div class="dup-lab">Marked as not the same person · ' + gone.length + '</div><button type="button" class="dup-link" data-act="toggle" aria-expanded="' + (S.showHidden ? "true" : "false") + '">' + (S.showHidden ? "Hide these" : "Show these") + "</button>";
        if (S.showHidden) h += gone.map(function (g) { return card(g, true); }).join("");
      }
      h += '<p class="dup-note">Compared ' + S.records.length + " records: the 50 most recently changed customer cards, orders, DDA, POYC and repeat prescriptions for the last " + MONTHS + " months, bookings two months either side of today, and everything in the other sections. People are grouped by the same ID card, the same phone number, or the same name and date of birth; never when their ID cards or dates of birth differ. “Not the same person” is kept on this device only." + (S.canLink ? " “Same person — link” records that the records are one person, for everyone in this pharmacy; it changes no record and can be undone." : "") + "</p>";
    }
    h += "</div>";
    m.innerHTML = h;
    wire(m);
    if (focusSel) { var f = m.querySelector(focusSel); if (f) try { f.focus(); } catch (e) {} }
  }

  function groupById(id) { return (S.groups || []).filter(function (g) { return g.id === id; })[0]; }
  function openRecord(kind, uid) {
    var r = S.records.filter(function (x) { return x.uid === uid; })[0];
    var reg = (LABEL[kind] || {}).reg;
    try { sessionStorage.setItem("eikon_ui2_return", "dupreg"); } catch (e) {}
    if (kind === "people" || reg === "customers") { try { sessionStorage.setItem("eikon_customers_q", r ? (normId(r.idRaw) || str(r.name)) : ""); } catch (e) {} window.location.hash = "#customers"; return; }
    var nat = E.UI2_NATIVE && E.UI2_NATIVE[reg];
    if (nat && E.modules[nat]) { window.location.hash = "#" + nat; return; }
    if (E.modules[reg] && E.modules[reg].ui2Only) { window.location.hash = "#" + reg; return; }
    if (reg === "bookings") { window.location.hash = "#bookings"; return; }
    if (E.openClassic) E.openClassic(reg); else window.location.hash = "#" + reg;
  }
  function wire(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = "#customers";
        else if (a === "reload") { S.undo = null; load(); }
        else if (a === "more") { S.limit = (S.limit || 40) + 40; paint(); }
        else if (a === "toggle") { S.showHidden = !S.showHidden; paint('[data-act="toggle"]'); }
        else if (a === "toggle-linked") { S.showLinked = !S.showLinked; paint('[data-act="toggle-linked"]'); }
        else if (a === "unlink-last" && S.linkUndo) { var lu = S.linkUndo; doUnlink(lu.ids, lu.name, '[data-link="' + lu.gid + '"]'); }
        else if (a === "undo" && S.undo) { var id = S.undo.id; setHidden(hidden().filter(function (x) { return x !== id; })); S.undo = null; paint('[data-hide="' + id + '"]'); E.toast("Shown again", "success"); }
      });
    });
    m.querySelectorAll("[data-hide]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-hide"), g = groupById(id); if (!g) return;
        var list = hidden(); if (list.indexOf(id) < 0) list.push(id);
        if (!setHidden(list)) { E.toast("This device would not keep it. Nothing was hidden.", "warn"); return; }
        S.undo = { id: id, name: g.name };
        paint('[data-act="undo"]');
      });
    });
    m.querySelectorAll("[data-show]").forEach(function (b) {
      b.addEventListener("click", function () { var id = b.getAttribute("data-show"); setHidden(hidden().filter(function (x) { return x !== id; })); S.undo = null; paint('[data-hide="' + id + '"]'); });
    });
    m.querySelectorAll("[data-link]").forEach(function (b) { b.addEventListener("click", function () { doLink(b.getAttribute("data-link")); }); });
    m.querySelectorAll("[data-unlink]").forEach(function (b) {
      b.addEventListener("click", function () { var gid = b.getAttribute("data-unlink"), g = (S.groups || []).filter(function (x) { return x.linked === gid; })[0]; doUnlink(linkIdsOf(gid), g ? g.name : "", '[data-act="toggle-linked"]'); });
    });
    m.querySelectorAll("[data-open]").forEach(function (b) { b.addEventListener("click", function () { openRecord(b.getAttribute("data-open"), b.getAttribute("data-uid")); }); });
  }

  E.registerModule({
    id: "dupreg", title: "Possible duplicates", order: 2, icon: "◯", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.undo = null; S.linkUndo = null; S.showHidden = false; S.showLinked = false; S.busy = false; S.limit = 40; css(); return load(); },
    destroy: function () { S.seq++; }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("dupreg") < 0) E.UI2_DESTINATIONS.push("dupreg");
  if (E.UI2_PARENT) E.UI2_PARENT.dupreg = "customers";
})();
