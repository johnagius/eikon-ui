/* Audit trail, new layout: who changed what, newest first, by Malta day. Filters for the days, the area and the kind of
   change go to the server (the classic /audit/log call, admin only, this organisation's rows); the person and the search
   narrow the rows already loaded, and "Show older" brings the next page. A tap opens the change: before and after when
   the record kept them, every other detail, and the raw action code. Read only. Print keeps the classic print. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var PAGE = 100;
  var S = { mount: null, entries: [], total: 0, loading: false, more: false, error: "", denied: false, seq: 0,
    from: "", to: "", area: "", kind: "", person: "", q: "", open: {} };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var TZ = "Europe/Malta";

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function low(s) { return String(s == null ? "" : s).toLowerCase(); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // ── Malta time. The server stores UTC as "YYYY-MM-DD HH:MM:SS" with no zone mark.
  var fmt = null;
  function parts(ms) {
    if (!fmt) fmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    var o = {}; fmt.formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }
  function utcMs(s) { var t = String(s || "").trim(); if (!t) return NaN; return Date.parse(t.replace(" ", "T") + (/[zZ]$|[+-]\d\d:?\d\d$/.test(t) ? "" : "Z")); }
  function mYmd(ms) { var p = parts(ms); return p.y + "-" + pad(p.mo) + "-" + pad(p.d); }
  function mHm(ms) { var p = parts(ms); return pad(p.h) + ":" + pad(p.mi); }
  function mFull(ms) { var p = parts(ms); return p.d + " " + MON[p.mo - 1] + " " + p.y + ", " + pad(p.h) + ":" + pad(p.mi) + ":" + pad(p.s); }
  function offset(ms) { var p = parts(ms); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; }
  function midnight(ymd) { var a = ymd.split("-"), g = Date.UTC(+a[0], +a[1] - 1, +a[2]), t = g - offset(g); return g - offset(t); } // Malta 00:00 as a UTC instant
  function utcStr(ms) { return new Date(ms).toISOString().slice(0, 19).replace("T", " "); }
  function addDays(ymd, n) { var a = ymd.split("-"), d = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2] + n)); return d.toISOString().slice(0, 10); }
  function today() { return mYmd(Date.now()); }
  function dayLabel(ymd) {
    if (ymd === today()) return "Today";
    if (ymd === addDays(today(), -1)) return "Yesterday";
    var a = ymd.split("-"); return Number(a[2]) + " " + MON[+a[1] - 1] + (a[0] === today().slice(0, 4) ? "" : " " + a[0]);
  }

  // ── Areas. The first nine are the classic module filter (the server maps each to its tables); the rest are single
  // tables, which the server accepts as they are.
  var GROUPS = [
    ["temperature", "Temperature", ["temperature_devices", "temperature_entries"]],
    ["dailyregister", "Daily register", ["daily_register_entries"]],
    ["ddasales", "Controlled drugs: sales", ["dda_sales_entries"]],
    ["ddapoyc", "Controlled drugs: POYC", ["dda_poyc_entries"]],
    ["ddapurchases", "Controlled drugs: purchases", ["dda_purchases_entries"]],
    ["ddastocktakes", "Controlled drugs: stock takes", ["dda_stocktakes", "dda_stocktake_items"]],
    ["cleaning", "Cleaning", ["cleaning_entries"]],
    ["certificates", "Certificates", ["certificates_items"]],
    ["locumregister", "Locum register", ["locum_register_entries"]]
  ];
  var ENT = {
    temperature_devices: "Temperature: fridges and rooms", temperature_entries: "Temperature", daily_register_entries: "Daily register",
    dda_sales_entries: "Controlled drugs: sales", dda_poyc_entries: "Controlled drugs: POYC", dda_purchases_entries: "Controlled drugs: purchases",
    dda_stocktakes: "Controlled drugs: stock takes", dda_stocktake_items: "Controlled drugs: stock take lines", cleaning_entries: "Cleaning",
    certificates_items: "Certificates", locum_register_entries: "Locum register",
    user: "Sign-in and passwords", org: "Organisation", location: "Pharmacy set-up", people: "Customers",
    paid_out_entries: "Paid out", repeat_prescription_entries: "Repeat prescriptions", credit_notes: "Credit notes", locum_receipts: "Locum receipts",
    end_of_day: "End of day", end_of_day_contacts: "End of day: contacts", client_orders_entries: "Client orders", client_tickets_entries: "Tickets",
    client_deliveries: "Deliveries", quotation_entries: "Quotations", order_diary_entries: "Order diary", alerts_entries: "Alerts",
    near_expiry_entries: "Near expiry", returns_entries: "Returns", stock_transfer_items: "Stock transfers", stock_transfer_requests: "Stock transfer requests",
    scarce_stock_offers: "Scarce stock: offers", scarce_stock_offer_requests: "Scarce stock: requests", scarce_stock_needs: "Scarce stock: needs", scarce_stock_need_offers: "Scarce stock: offers on needs",
    shift_staff: "Shifts: staff", shift_assignments: "Shifts", shift_leaves: "Leave",
    vaccines_stock: "Vaccines: stock", vaccines_orders: "Vaccines: orders", vaccines_catalog: "Vaccines: catalogue",
    supplier_orders: "Supplier orders", supplier_products: "Supplier products", pos_sales: "Emergency till: sales", pos_products: "Emergency till: products",
    loyalty_transactions: "Loyalty: points", loyalty_clients: "Loyalty: clients", loyalty_campaigns: "Loyalty: campaigns",
    appt_appointments: "Appointments", appt_waitlist: "Appointments: waiting list", appt_schedules: "Appointments: schedules", appt_doctors: "Appointments: doctors", appt_clinics: "Appointments: clinics",
    bk_bookings: "Bookings", bk_waitlist: "Bookings: waiting list", bk_settings: "Bookings: settings", bk_services: "Bookings: services", bk_senders: "Bookings: email senders", bk_rooms: "Bookings: rooms", bk_providers: "Bookings: providers",
    cherubino_oos: "Cherubino: out of stock", cherubino_orders: "Cherubino: orders", cherubino_price_changes: "Cherubino: price changes", cherubino_short_expiry: "Cherubino: short expiry",
    pv_reports: "Pharmacovigilance", screening_campaigns: "Screening", poct_records: "Point-of-care tests", label_history: "Labels",
    contacts_suppliers: "Contacts: suppliers", contacts_medreps: "Contacts: med reps", contacts_headoffice: "Contacts: head office", contacts_orgpharmacies: "Contacts: our pharmacies",
    contacts_poyc: "Contacts: POYC", contacts_locums: "Contacts: locums", contacts_doctors: "Contacts: doctors", contacts_specialists: "Contacts: specialists", contacts_clients: "Contacts: clients"
  };
  function inGroup(t) { return GROUPS.some(function (g) { return g[2].indexOf(t) >= 0; }); }
  function areaOptions() {
    var rest = Object.keys(ENT).filter(function (t) { return !inGroup(t); }).map(function (t) { return [t, ENT[t]]; })
      .sort(function (a, b) { return a[1].localeCompare(b[1]); });
    return { groups: GROUPS.map(function (g) { return [g[0], g[1]]; }), rest: rest };
  }
  function humanize(s) { var t = String(s || "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").trim().toLowerCase(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ""; }
  function areaLabel(t) { return ENT[t] || humanize(t) || "Other"; }

  // ── Actions. A kind is decided by one word in the code, the same word the server filter looks for, so the server and the
  // screen always agree on what "Deleted" means; the readable name is more precise.
  var KINDS = [["created", "Created", "CREATE"], ["changed", "Changed", "UPDATE"], ["deleted", "Deleted", "DELETE"], ["signin", "Signed in", "LOGIN"], ["signout", "Signed out", "LOGOUT"]];
  function kindOf(a) {
    a = String(a || "").toUpperCase();
    if (a.indexOf("LOGIN_FAILED") >= 0) return "failed";
    if (a.indexOf("LOGIN") >= 0) return "signin";
    if (a.indexOf("LOGOUT") >= 0) return "signout";
    if (a.indexOf("DELETE") >= 0) return "deleted";
    if (a.indexOf("CREATE") >= 0) return "created";
    if (a.indexOf("UPDATE") >= 0) return "changed";
    return "other";
  }
  var WORDS = [
    [/PASSWORD_CHANGE/, "Password changed"], [/ADMIN_RECOVER_RESET/, "Password reset by recovery"], [/ADMIN_RECOVER_VERIFY_OK/, "Recovery code accepted"],
    [/ADMIN_RECOVER_VERIFY_FAIL/, "Recovery code refused"], [/ADMIN_RECOVER_NOT_FOUND/, "Recovery: no such account"], [/ADMIN_RECOVER_BAD_TOKEN/, "Recovery: link not valid"],
    [/LOGIN_FAILED/, "Sign-in failed"], [/LOGIN/, "Signed in"], [/LOGOUT/, "Signed out"],
    [/AUTO_DELETE/, "Deleted automatically"], [/AUTO_CREATE/, "Created automatically"], [/AUTO_CLOSE/, "Closed automatically"],
    [/DELETE/, "Deleted"], [/CREATE_RETURN/, "Return created"], [/CREATE/, "Created"], [/UPDATE/, "Changed"],
    [/UPSERT|_PUT$|BULK_SAVE|_BATCH$/, "Saved"], [/_ADD$/, "Added"], [/_EDIT$/, "Changed"], [/REOPEN/, "Reopened"], [/UNLOCK/, "Unlocked"], [/_LOCK$/, "Locked"], [/CLOSE/, "Closed"],
    [/UPLOAD/, "Uploaded"], [/APPROVE/, "Approved"], [/REJECT/, "Refused"], [/VOID/, "Voided"], [/CONFIRM/, "Confirmed"], [/ACCEPT/, "Accepted"],
    [/IMPORT/, "Imported"], [/MERGE/, "Merged"], [/DISPATCH/, "Dispatched"], [/DELIVERY/, "Delivered"], [/CANCEL/, "Cancelled"], [/MOVE/, "Moved"],
    [/BACK_IN_STOCK|MARK_BACK/, "Back in stock"], [/REQUEST_REMOVAL/, "Removal asked"], [/_KEEP$/, "Kept"], [/DEPLETED/, "Marked as run out"],
    [/PLACE_RETURNS/, "Sent to returns"], [/PLACE_SCARCE/, "Sent to scarce stock"], [/PLACE_TRANSFER/, "Sent to stock transfers"], [/APPLY_PATTERN/, "Pattern applied"],
    [/CARRY_OVER/, "Carried over"], [/AWAY/, "Marked away"], [/BACKFILL/, "Filled in from records"], [/SYNC/, "Synced"], [/WIPE_ALL|_CLEAR$/, "Cleared"], [/DEACTIVATE/, "Switched off"]
  ];
  function actionName(a) {
    var c = String(a || "").toUpperCase();
    for (var i = 0; i < WORDS.length; i++) if (WORDS[i][0].test(c)) return WORDS[i][1];
    var w = c.split("_"); return humanize(w[w.length - 1] || c) || "Recorded";
  }

  // ── What changed
  function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
  function same(a, b) { return JSON.stringify(a == null ? "" : a) === JSON.stringify(b == null ? "" : b); }
  function val(v) {
    if (v === null || v === undefined || v === "") return '<i class="aud-none">empty</i>';
    if (typeof v === "object") return '<pre class="aud-pre">' + esc(JSON.stringify(v, null, 2)) + "</pre>";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return esc(String(v));
  }
  var QUIET = { id: 1, org_id: 1, created_at: 1, updated_at: 1, created_by: 1, updated_by: 1, version: 1 };
  function changes(d) { // [{label, before, after, has: "both"|"after"|"before"}], and the details that are not a before/after pair
    var out = [], used = {};
    if (isObj(d.before) || isObj(d.after)) {
      var b = isObj(d.before) ? d.before : null, a = isObj(d.after) ? d.after : null;
      var keys = Object.keys(b || {}).concat(Object.keys(a || {})).filter(function (k, i, l) { return l.indexOf(k) === i && !QUIET[k]; });
      keys.forEach(function (k) {
        if (b && a) { if (!same(b[k], a[k])) out.push({ label: humanize(k), before: b[k], after: a[k], has: "both" }); }
        else if (a) { if (a[k] !== "" && a[k] != null) out.push({ label: humanize(k), after: a[k], has: "after" }); }
        else if (b[k] !== "" && b[k] != null) out.push({ label: humanize(k), before: b[k], has: "before" });
      });
      used.before = used.after = 1;
      if (b && a && !out.length) out.nochange = true;
    }
    Object.keys(d).forEach(function (k) { // oldPrice / newPrice, old_status / new_status
      var m = k.match(/^old_?(.+)$/i); if (!m) return;
      var tail = m[1], nk = Object.keys(d).filter(function (x) { return x !== k && low(x).replace(/_/g, "") === "new" + low(tail).replace(/_/g, ""); })[0];
      if (!nk) return;
      out.push({ label: humanize(tail), before: d[k], after: d[nk], has: "both" }); used[k] = used[nk] = 1;
    });
    var rest = Object.keys(d).filter(function (k) { return !used[k]; });
    return { list: out, rest: rest };
  }
  function summary(r) {
    var d = isObj(r.details) ? r.details : {}, c = changes(d);
    if (c.list.nochange) return "No field changed";
    if (c.list.length && c.list[0].has === "both") return c.list.length + (c.list.length === 1 ? " field changed: " : " fields changed: ") + c.list.map(function (x) { return x.label; }).join(", ");
    var bits = c.list.filter(function (x) { return typeof (x.after != null ? x.after : x.before) !== "object"; }).slice(0, 3).map(function (x) { return x.label + ": " + String(x.after != null ? x.after : x.before); });
    if (!bits.length) bits = c.rest.filter(function (k) { var v = d[k]; return v !== "" && v != null && typeof v !== "object"; }).slice(0, 3).map(function (k) { return humanize(k) + ": " + String(d[k]); });
    return bits.join(" · ");
  }
  function detailHtml(r) {
    var d = isObj(r.details) ? r.details : {}, c = changes(d), ms = utcMs(r.created_at), h = '<div class="aud-det" id="aud-det-' + esc(r.id) + '">';
    h += '<dl class="aud-dl"><dt>When</dt><dd>' + esc(isNaN(ms) ? r.created_at : mFull(ms) + " (Malta time)") + "</dd>" +
      "<dt>Who</dt><dd>" + esc(r.user_name || "Unknown") + "</dd>" +
      "<dt>Area</dt><dd>" + esc(areaLabel(r.entity_type)) + ' <code class="aud-code">' + esc(r.entity_type || "") + "</code></dd>" +
      (r.entity_id ? "<dt>Record</dt><dd>" + esc(r.entity_id) + "</dd>" : "") +
      "<dt>Action code</dt><dd><code class=\"aud-code\">" + esc(r.action) + "</code></dd></dl>";
    if (c.list.length) {
      var both = c.list.some(function (x) { return x.has === "both"; }), onlyAfter = c.list.every(function (x) { return x.has === "after"; });
      h += '<div class="aud-h">' + (both ? "What changed" : onlyAfter ? "Recorded as" : "As it was") + "</div>";
      h += '<div class="aud-ch">' + c.list.map(function (x) {
        return '<div class="aud-cr"><div class="k">' + esc(x.label) + "</div>" +
          (x.has === "both" ? '<div class="v"><span class="was"><small>Before</small>' + val(x.before) + '</span><span class="now"><small>After</small>' + val(x.after) + "</span></div>"
            : '<div class="v"><span>' + val(x.has === "after" ? x.after : x.before) + "</span></div>") + "</div>";
      }).join("") + "</div>";
    }
    if (c.list.nochange) h += '<div class="aud-h">What changed</div><p class="aud-none2">Saved again with no change to its fields.</p>';
    if (c.rest.length) {
      h += '<div class="aud-h">' + (c.list.length ? "Other details" : "Details") + '</div><dl class="aud-dl">' +
        c.rest.map(function (k) { return "<dt>" + esc(humanize(k)) + "</dt><dd>" + val(d[k]) + "</dd>"; }).join("") + "</dl>";
    }
    if (!c.list.length && !c.rest.length && !c.list.nochange) h += '<p class="aud-none2">No other details were kept for this change.</p>';
    return h + "</div>";
  }

  function css() {
    if (document.getElementById("eikon-audreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-audreg-css";
    st.textContent =
      ".aud{max-width:880px;margin:0 auto}" +
      ".aud-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;min-height:44px;padding:0;margin:-10px 0 0;cursor:pointer}" +
      ".aud-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".aud h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.aud-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".aud-btn{font:inherit;font-size:14px;font-weight:600;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".aud-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.aud-btn:disabled{opacity:.55;cursor:default}" +
      ".aud :focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".aud-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:16px}" +
      ".aud-chips button{font:inherit;font-size:13px;font-weight:600;height:30px;padding:0 12px;border-radius:15px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".aud-chips button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".aud-f{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:10px}" +
      ".aud-f label{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:12px;font-weight:600;color:var(--muted)}" +
      ".aud-f input,.aud-f select,.aud-q{width:100%;min-width:0;box-sizing:border-box;height:38px;border-radius:10px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:15px;padding:0 10px}" +
      ".aud-q{height:40px;border-radius:12px;font-size:16px;padding:0 12px;margin-top:10px}" +
      ".aud-count{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:14px 2px 0;font-size:13px;color:var(--muted)}" +
      ".aud-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:18px 2px 7px}" +
      ".aud-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".aud-item{border-top:.5px solid var(--border)}.aud-item:first-child{border-top:0}" +
      ".aud-row{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;font:inherit;color:inherit;background:none;border:0;padding:11px 16px;cursor:pointer}" +
      ".aud-row:hover{background:rgba(118,118,128,.06)}" +
      ".aud-dot{flex:0 0 8px;height:8px;border-radius:4px;margin-top:7px;background:var(--muted)}.aud-dot.created{background:var(--ok,#1F8A4C)}.aud-dot.changed{background:#3B7BE0}.aud-dot.deleted{background:var(--danger)}.aud-dot.signin,.aud-dot.signout{background:var(--warn,#A06A0E)}" +
      ".aud-row .t{flex:1;min-width:0}.aud-row b{font-size:15px;font-weight:600}.aud-row .s{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".aud-row .w{display:block;font-size:13px;color:var(--text);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".aud-row em{font-style:normal;font-size:13px;font-variant-numeric:tabular-nums;color:var(--muted);white-space:nowrap;margin-top:2px}" +
      ".aud-det{padding:4px 16px 14px 36px;font-size:14px}" +
      ".aud-dl{display:grid;grid-template-columns:minmax(90px,auto) minmax(0,1fr);gap:4px 12px;margin:6px 0 0}.aud-dl dt{color:var(--muted);font-size:13px}.aud-dl dd{margin:0;min-width:0;overflow-wrap:anywhere}" +
      ".aud-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--muted);overflow-wrap:anywhere}" +
      ".aud-h{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:14px 0 6px}" +
      ".aud-ch{border:1px solid var(--border);border-radius:10px;overflow:hidden}.aud-cr{padding:8px 12px;border-top:.5px solid var(--border)}.aud-cr:first-child{border-top:0}" +
      ".aud-cr .k{font-size:13px;font-weight:600}.aud-cr .v{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:6px 12px;margin-top:3px}.aud-cr .v span{min-width:0;overflow-wrap:anywhere}" +
      ".aud-cr small{display:block;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.aud-cr .was{color:var(--muted)}.aud-cr .was>:not(small){text-decoration:line-through;text-decoration-color:rgba(127,127,127,.6)}" +
      ".aud-pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:rgba(127,127,127,.08);border-radius:6px;padding:6px 8px;max-height:260px;overflow:auto}" +
      ".aud-none{color:var(--muted)}.aud-none2{color:var(--muted);font-size:13px;margin:10px 0 0}" +
      ".aud-more{display:flex;justify-content:center;margin-top:12px}" +
      ".aud-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".aud-foot{font-size:12.5px;color:var(--muted);margin-top:14px}.aud-foot a{color:var(--accent)}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .aud-chips button[aria-pressed=true]{color:#00160E}}" + // the bright dark-mode accent takes dark text, like every primary button
      "@media (max-width:760px){.aud-f{grid-template-columns:repeat(2,minmax(0,1fr))}.aud-f .wide{grid-column:1/-1}}" +
      "@media (max-width:600px){.aud{padding:4px 16px 0}.aud h1{font-size:32px}.aud-chips button{height:44px;border-radius:22px;padding:0 14px}.aud-f input,.aud-f select{height:44px;font-size:16px}.aud-row{padding:11px 14px}.aud-det{padding:4px 14px 14px 14px}}";
    document.head.appendChild(st);
  }

  function isAdmin() { var u = E.state && E.state.user; return !u || !u.role || u.role === "admin"; } // unknown: ask the server, which decides

  function query(offset) {
    var f = S.from, t = S.to; if (f && t && f > t) { var x = f; f = t; t = x; }
    var q = "?limit=" + PAGE + "&offset=" + offset;
    if (S.area) q += "&module=" + encodeURIComponent(S.area);
    var k = KINDS.filter(function (x) { return x[0] === S.kind; })[0]; if (k) q += "&action=" + encodeURIComponent(k[2]);
    // Malta days as UTC instants. The server compares the stored text and adds "T23:59:59" to the end bound, which
    // still cuts at the exact second given here.
    if (f) q += "&from=" + encodeURIComponent(utcStr(midnight(f)));
    if (t) q += "&to=" + encodeURIComponent(utcStr(midnight(addDays(t, 1)) - 1000));
    return q;
  }

  async function load(older) {
    var keepView = E.takeSaveFailed && E.takeSaveFailed();
    if (!isAdmin()) { S.denied = true; S.loading = false; return paint(); }
    var my = ++S.seq, offset = older ? S.entries.length : 0;
    if (older) S.more = true; else { S.loading = true; S.entries = []; S.total = 0; S.open = {}; }
    S.error = ""; paint();
    try {
      var r = await E.apiFetch("/audit/log" + query(offset), { method: "GET" });
      if (my !== S.seq) return;
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the audit trail");
      var seen = {}; S.entries.forEach(function (e) { seen[e.id] = 1; });
      S.entries = S.entries.concat((r.entries || []).filter(function (e) { return !seen[e.id]; })); // a change made meanwhile shifts the pages: no row twice
      // The server orders by the second only; changes made in the same second come back in any order. Newest id first.
      S.entries.sort(function (x, y) { return (utcMs(y.created_at) || 0) - (utcMs(x.created_at) || 0) || Number(y.id) - Number(x.id); });
      S.total = Number(r.total) || 0;
    } catch (e) {
      if (my !== S.seq) return;
      if (e && e.status === 403) S.denied = true;
      else if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the audit trail");
    }
    S.loading = false; S.more = false; E.whenFormIdle(S.mount, paint);
  }

  function rowText(r) { return low([r.user_name, areaLabel(r.entity_type), r.entity_type, actionName(r.action), r.action, r.entity_id, JSON.stringify(r.details || {})].join(" ")); }
  function shown() {
    var q = low(S.q).trim(), words = q ? q.split(/\s+/) : [];
    return S.entries.filter(function (r) {
      if (S.kind && kindOf(r.action) !== S.kind) return false; // "Signed in" asks the server for LOGIN; a failed sign-in is not one
      if (S.person && String(r.user_id == null ? "" : r.user_id) + "|" + (r.user_name || "") !== S.person) return false;
      if (words.length) { var t = rowText(r); return words.every(function (w) { return t.indexOf(w) >= 0; }); }
      return true;
    });
  }
  function people() {
    var seen = {}, out = [];
    S.entries.forEach(function (r) { var k = String(r.user_id == null ? "" : r.user_id) + "|" + (r.user_name || ""); if (!seen[k]) { seen[k] = 1; out.push([k, r.user_name || "Unknown"]); } });
    if (S.person && !seen[S.person]) out.push([S.person, S.person.split("|").slice(1).join("|") || "Unknown"]);
    return out.sort(function (a, b) { return a[1].localeCompare(b[1]); });
  }
  function range() { // which quick range matches the dates, if any
    var t = today(); if (S.to !== t) return "";
    var n = { 0: "1", 6: "7", 29: "30", 89: "90" }, days = Math.round((Date.parse(S.to) - Date.parse(S.from)) / 864e5);
    return n[days] || "";
  }

  function keep() {
    var m = S.mount; if (!m) return;
    var qi = m.querySelector("#aud-q"); if (qi) S.q = qi.value;
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "audreg") return; // left before a reply came back: do not draw over the next screen
    keep();
    var h = '<div class="aud"><button class="aud-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("audreg") : "‹ Settings") + "</button>" +
      '<div class="aud-top"><div><h1>Audit trail</h1><p class="aud-sub">Who changed what, across the whole system. Times are Malta time.</p></div>' +
      (S.denied ? "" : '<button class="aud-btn" data-act="print"' + (S.entries.length ? "" : " disabled") + ">Print</button>") + "</div>";
    if (S.denied) {
      h += '<div class="aud-quiet">Only a pharmacist (admin) can see the audit trail. Ask the pharmacist in charge if you need to know who changed something.</div></div>';
      m.innerHTML = h; bind(m); return;
    }
    var rg = range(), ao = areaOptions();
    h += '<div class="aud-chips" role="group" aria-label="Quick range">' + [["1", "Today"], ["7", "7 days"], ["30", "30 days"], ["90", "90 days"]].map(function (c) {
      return '<button type="button" data-range="' + c[0] + '" aria-pressed="' + (rg === c[0]) + '">' + c[1] + "</button>"; }).join("") + "</div>";
    h += '<div class="aud-f">' +
      '<label>From<input type="date" id="aud-from" value="' + esc(S.from) + '" max="' + esc(today()) + '"></label>' +
      '<label>To<input type="date" id="aud-to" value="' + esc(S.to) + '" max="' + esc(today()) + '"></label>' +
      '<label class="wide">Area<select id="aud-area"><option value="">All areas</option><optgroup label="Registers">' +
        ao.groups.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (S.area === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") +
        '</optgroup><optgroup label="Everything else">' + ao.rest.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (S.area === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</optgroup></select></label>" +
      '<label>Change<select id="aud-kind"><option value="">Any change</option>' + KINDS.map(function (k) { return '<option value="' + k[0] + '"' + (S.kind === k[0] ? " selected" : "") + ">" + k[1] + "</option>"; }).join("") + "</select></label>" +
      '<label>Person<select id="aud-person"><option value="">Everyone</option>' + people().map(function (p) { return '<option value="' + esc(p[0]) + '"' + (S.person === p[0] ? " selected" : "") + ">" + esc(p[1]) + "</option>"; }).join("") + "</select></label>" +
      "</div>";
    h += '<input class="aud-q" id="aud-q" type="search" aria-label="Search the changes" placeholder="Search name, record, action or detail" value="' + esc(S.q) + '">';
    if (S.loading && !S.entries.length) h += '<div class="aud-quiet">Opening the audit trail…</div>';
    else if (S.error && !S.entries.length) h += '<div class="aud-quiet" role="alert">' + esc(S.error) + ' <button class="aud-btn" data-act="retry">Try again</button></div>';
    else {
      var list = shown(), narrowed = !!(S.person || low(S.q).trim() || (S.kind && list.length !== S.entries.length)), more = S.entries.length < S.total;
      h += '<div class="aud-count" role="status"><span>' + (narrowed
        ? list.length + (list.length === 1 ? " match" : " matches") + " in the " + S.entries.length + " newest of " + S.total + (S.total === 1 ? " change" : " changes")
        : (S.total ? "Showing " + S.entries.length + " of " + S.total + (S.total === 1 ? " change" : " changes") : "")) + "</span></div>";
      if (!list.length) h += '<div class="aud-quiet">' + (S.entries.length ? "Nothing among the loaded changes matches." + (more ? " Show older ones to look further back." : "") : "No changes in these days.") + "</div>";
      var days = [], by = {};
      list.forEach(function (r) { var ms = utcMs(r.created_at), d = isNaN(ms) ? String(r.created_at || "").slice(0, 10) : mYmd(ms); if (!by[d]) { by[d] = []; days.push(d); } by[d].push(r); });
      days.forEach(function (d) {
        h += '<div class="aud-lab">' + esc(/^\d{4}-\d{2}-\d{2}$/.test(d) ? dayLabel(d) : d) + '</div><div class="aud-list">' + by[d].map(function (r) {
          var ms = utcMs(r.created_at), open = !!S.open[r.id], sm = summary(r), k = kindOf(r.action);
          return '<div class="aud-item"><button type="button" class="aud-row" data-id="' + esc(r.id) + '" aria-expanded="' + open + '" aria-controls="aud-det-' + esc(r.id) + '">' +
            '<span class="aud-dot ' + k + '" aria-hidden="true"></span><span class="t"><b>' + esc(actionName(r.action)) + "</b> · " + esc(areaLabel(r.entity_type)) +
            (sm ? '<span class="w">' + esc(sm) + "</span>" : "") +
            '<span class="s">' + esc(r.user_name || "Unknown") + (r.entity_id ? " · record " + esc(r.entity_id) : "") + "</span></span>" +
            "<em>" + esc(isNaN(ms) ? "" : mHm(ms)) + "</em></button>" + (open ? detailHtml(r) : "") + "</div>";
        }).join("") + "</div>";
      });
      if (S.error) h += '<div class="aud-quiet" role="alert">' + esc(S.error) + ' <button class="aud-btn" data-act="' + (more ? "older" : "retry") + '">Try again</button></div>';
      if (more) h += '<div class="aud-more"><button class="aud-btn" data-act="older"' + (S.more ? " disabled" : "") + ">" + (S.more ? "Loading…" : "Show older") + "</button></div>";
    }
    h += '<p class="aud-foot">The same list is in the <a href="#" data-act="classic">classic audit trail</a>, with a filter for any action code.</p></div>';
    var ae = document.activeElement, keepSel = ae && m.contains(ae) && ae.id ? "#" + ae.id : ae && m.contains(ae) && ae.getAttribute && ae.getAttribute("data-id") ? '.aud-row[data-id="' + ae.getAttribute("data-id") + '"]' : ae && m.contains(ae) && ae.getAttribute && ae.getAttribute("data-act") ? '[data-act="' + ae.getAttribute("data-act") + '"]' : "";
    var caret = null; if (ae && ae.id === "aud-q") { try { caret = ae.selectionStart; } catch (x) {} }
    m.innerHTML = h;
    if (keepSel) { var again = m.querySelector(keepSel); if (again) { again.focus({ preventScroll: true }); if (caret != null) { try { again.setSelectionRange(caret, caret); } catch (x) {} } } } // typing keeps its place
    bind(m);
  }

  function bind(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("audreg") : "#settings";
        else if (a === "older") load(true);
        else if (a === "retry") load(false);
        else if (a === "print") printList();
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "audreg"); } catch (x) {} E.openClassic("audit"); }
      });
    });
    m.querySelectorAll("[data-range]").forEach(function (b) {
      b.addEventListener("click", function () { var n = Number(b.getAttribute("data-range")); S.to = today(); S.from = addDays(S.to, -(n - 1)); load(false); });
    });
    m.querySelectorAll(".aud-row").forEach(function (b) {
      b.addEventListener("click", function () { var id = b.getAttribute("data-id"); if (S.open[id]) delete S.open[id]; else S.open[id] = 1; paint(); });
    });
    var on = function (id, ev, fn) { var el = m.querySelector(id); if (el) el.addEventListener(ev, fn); };
    on("#aud-from", "change", function () { var v = this.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { S.from = v; load(false); } });
    on("#aud-to", "change", function () { var v = this.value; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { S.to = v; load(false); } });
    on("#aud-area", "change", function () { S.area = this.value; load(false); });
    on("#aud-kind", "change", function () { S.kind = this.value; load(false); });
    on("#aud-person", "change", function () { S.person = this.value; paint(); });
    on("#aud-q", "input", function () { paint(); });
  }

  // ── Print: the rows on screen, as the classic prints its page.
  function printList() {
    var list = shown(), sub = [];
    if (S.area) { var o = areaOptions(), all = o.groups.concat(o.rest), hit = all.filter(function (x) { return x[0] === S.area; })[0]; sub.push("Area: " + (hit ? hit[1] : S.area)); }
    if (S.kind) sub.push("Change: " + KINDS.filter(function (k) { return k[0] === S.kind; })[0][1]);
    if (S.person) sub.push("Person: " + S.person.split("|").slice(1).join("|"));
    if (low(S.q).trim()) sub.push("Search: " + S.q.trim());
    var rows = list.map(function (r) {
      var ms = utcMs(r.created_at), d = isObj(r.details) ? r.details : {}, det = Object.keys(d).map(function (k) { var v = d[k]; return v === "" || v == null ? "" : humanize(k) + ": " + (typeof v === "object" ? JSON.stringify(v) : String(v)); }).filter(Boolean).join("; ");
      return [isNaN(ms) ? String(r.created_at || "") : mFull(ms), r.user_name || "", areaLabel(r.entity_type), { html: esc(actionName(r.action)) + "<br><small>" + esc(r.action) + "</small>" }, r.entity_id == null ? "" : String(r.entity_id), { html: '<span style="font-size:9.5px">' + esc(det) + "</span>" }];
    });
    var nice = function (v) { var a = String(v || "").split("-"); return a.length === 3 ? Number(a[2]) + " " + MON[+a[1] - 1] + " " + a[0] : "…"; };
    // E.months.print: the pharmacy's name, the period, page numbers, black on white, as every register prints
    if (E.months && E.months.print) {
      E.months.print({ register: "Audit trail", period: (S.from || S.to ? nice(S.from) + " to " + nice(S.to) : "All days") + " · Malta time", landscape: true,
        sections: [{ sub: sub.concat([list.length + (list.length === 1 ? " row" : " rows")]).join(" | "), cols: ["When", "Who", "Area", "Action", "Record", "Details"], rows: rows, empty: "No changes in these days." }] });
      return;
    }
    window.print();
  }

  E.registerModule({
    id: "audreg", title: "Audit trail", order: 101, icon: "🔒", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.to = today(); S.from = addDays(S.to, -29); S.area = ""; S.kind = ""; S.person = ""; S.q = ""; S.open = {}; S.denied = false; S.entries = []; S.total = 0;
      css(); paint(); return load(false);
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("audreg") < 0) E.UI2_DESTINATIONS.push("audreg");
  if (E.UI2_PARENT) E.UI2_PARENT.audreg = "settings";
})();
