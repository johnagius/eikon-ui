/* People who sign in (Team), new layout, pharmacy admin only (backlog 2 item 4).
   This pharmacy's sign-ins: add a person (a temporary password is shown ONCE, with Copy; they choose their own at
   first sign-in), give a new temporary password, switch a sign-in off (every device of theirs is signed out at once)
   or on again. Your own sign-in, another admin's (unless Eikon support allows it) and Eikon support's are listed
   but not changed here. Staff never see the card, and the screen says so if opened by address.
   Routes (worker, own pharmacy only):
     GET  /team/users                        {users:[{id,email,full_name,role,is_active,must_change_password,last_sign_in_at,signed_in_devices,protected}], me, admins_manage_admins}
     POST /team/users {email,full_name,role} {user, temporary_password}
     POST /team/users/:id/password           {temporary_password}
     POST /team/users/:id/active {active}
     POST /team/users/:id/role {role}        staff | pharmacist | admin (an existing admin: only when admins_manage_admins)
     POST /team/users/:id/rights {plans_rota} a staff or pharmacist sign-in may plan the rota (roles round)
     GET  /shifts/staff                      the rota people, each with user_id: "On the rota as …"
     POST /shifts/staff/:id/link {user_id}   this rota person is this sign-in (link only: nothing merged or deleted)
   Roles: Admin (everything), Pharmacist (staff + the pharmacist in charge's month sign-off + Correct on register lines), Staff. "Plans the rota" is
   on for every sign-in that existed before the roles release, off for new ones until the admin switches it on.
   The temporary password lives only in this screen's memory until Done (or leaving the screen); never stored. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var ID = "teamreg";
  var S = { mount: null, list: null, me: null, manageAdmins: false, loading: false, error: "", missing: false,
    q: "", adding: false, add: { name: "", email: "", role: "staff" }, addErr: "", fieldErr: {}, addSaving: false, shown: null, rowBusy: {}, rowErr: {}, rota: null };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function isAdmin() { var u = E.state.user; return !!(u && u.role === "admin"); }
  // The server's clocks are UTC ("2026-11-10 06:12:00"); everything shown is Malta time.
  function utc(s) { var t = String(s || "").trim(); if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(t)) return null; var d = new Date(t.replace(" ", "T") + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? "" : "Z")); return isFinite(d.getTime()) ? d : null; }
  function ymdAdd(ymd, k) { var d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
  function dayWord(ymd) {
    var t = E.maltaYmd(); if (ymd === t) return "today"; if (ymd === ymdAdd(t, -1)) return "yesterday";
    var p = ymd.split("-"); return Number(p[2]) + " " + MON[Number(p[1]) - 1] + (p[0] !== t.slice(0, 4) ? " " + p[0] : "");
  }
  function when(s) { var d = utc(s); if (!d) return ""; var w = dayWord(E.maltaYmd(d)); return w === "today" || w === "yesterday" ? w + " at " + E.maltaHm(d) : w; }
  function signedToday(u) { var d = utc(u.last_sign_in_at); return !!d && E.maltaYmd(d) === E.maltaYmd(); }
  function fold(s) { return E.people && E.people.foldMt ? E.people.foldMt(s) : String(s || "").toLowerCase(); }
  function roleWord(u) { return E.roleWord ? E.roleWord(u) : u.role === "admin" ? "Admin" : u.is_pharmacist ? "Pharmacist" : u.role === "staff" ? "Staff" : "Limited"; }
  function roleKey(u) { return u.role === "admin" ? "admin" : u.is_pharmacist ? "pharmacist" : "staff"; }
  // The rota person this sign-in is (linked on the server), or one that carries their e-mail (offered as a link).
  function rotaOf(u) { var l = S.rota || []; return l.filter(function (p) { return String(p.user_id) === String(u.id); })[0] || null; }
  function rotaByEmail(u) { var e = String(u.email || "").toLowerCase(); if (!e) return null; return (S.rota || []).filter(function (p) { return p.user_id == null && Number(p.is_active) !== 0 && String(p.email || "").toLowerCase() === e; })[0] || null; }
  function rotaByName(u) { var f = E.rotaFold ? E.rotaFold(u.full_name) : fold(u.full_name); if (!f) return []; return (S.rota || []).filter(function (p) { return p.user_id == null && Number(p.is_active) !== 0 && (E.rotaFold ? E.rotaFold(p.full_name) : fold(p.full_name)) === f; }); }
  var SEARCH_FROM = 9; // a search box once the list no longer fits on one screen

  function css() {
    if (document.getElementById("eikon-teamreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-teamreg-css";
    st.textContent =
      ".tmr{max-width:880px;margin:0 auto}" +
      ".tmr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;min-height:44px;padding:0 12px 0 0;margin:-8px 0 -6px;cursor:pointer}" +
      ".tmr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".tmr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.tmr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0;max-width:620px;line-height:1.45}" +
      ".tmr-btn{font:inherit;font-size:14px;font-weight:600;min-height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".tmr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.tmr-btn:disabled{opacity:.55;cursor:default}.tmr-btn.red{color:var(--danger)}" +
      ".tmr-lab{font-size:13px;font-weight:600;color:var(--muted);margin:20px 2px 7px;font-variant-numeric:tabular-nums}" +
      ".tmr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".tmr-row{display:flex;align-items:center;gap:12px;min-height:60px;padding:10px 14px 10px 16px;border-top:.5px solid var(--border);flex-wrap:wrap}.tmr-row:first-child{border-top:0}" +
      ".tmr-row.off .tmr-who b{color:var(--muted)}.tmr-who{flex:1;min-width:200px}.tmr-who b{display:block;font-size:15.5px;font-weight:600;overflow-wrap:anywhere}.tmr-who span{display:block;font-size:13px;color:var(--muted);overflow-wrap:anywhere}" +
      ".tmr-who .tmr-pill{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:9px;background:var(--bg);color:var(--muted);margin-left:6px;vertical-align:1px}.tmr-who .tmr-pill.a{color:var(--accent)}.tmr-who .tmr-pill.w{color:var(--danger)}" +
      ".tmr-who span b.tmr-today{display:inline;font-size:inherit;font-weight:600;color:var(--text)}.tmr-who span{font-variant-numeric:tabular-nums}" +
      ".tmr-lab2{font-weight:400}" +
      ".tmr-q{display:block;width:100%;box-sizing:border-box;height:44px;margin-top:18px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px}.tmr-q:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".tmr-acts{display:flex;gap:8px;flex-wrap:wrap}.tmr-note{font-size:12.5px;color:var(--muted)}" +
      ".tmr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:14px}" +
      ".tmr-form .t{font-size:13px;font-weight:600;color:var(--muted);padding:8px 14px 4px}" +
      ".tmr-form label{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 14px;border-top:.5px solid var(--border)}" +
      ".tmr-form label>span{flex:0 0 84px;font-size:15px}.tmr-form input,.tmr-form select{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".tmr-form input:focus-visible,.tmr-form select:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}" +
      ".tmr-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end;align-items:center;flex-wrap:wrap}" +
      ".tmr-err{color:var(--danger);font-size:13px;padding:4px 14px}.tmr-ferr{display:block;color:var(--danger);font-size:13px;padding:0 14px 8px 110px}" +
      ".tmr-sk{height:60px;border-top:.5px solid var(--border)}.tmr-sk:first-child{border-top:0}.tmr-sk i{display:block;height:12px;border-radius:6px;background:rgba(118,118,128,.14);margin:14px 16px 0;width:30%}.tmr-sk i+i{width:55%;margin-top:10px}" +
      ".tmr-once{background:var(--panel2);border:2px solid var(--accent);border-radius:14px;padding:16px;margin-top:14px}" +
      ".tmr-once h2{font-size:17px;margin:0 0 6px}.tmr-once p{margin:6px 0;font-size:14px;color:var(--muted);line-height:1.45}" +
      ".tmr-pw{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0}.tmr-pw code{font-size:24px;font-weight:700;letter-spacing:.06em;font-family:ui-monospace,Menlo,Consolas,monospace;background:var(--bg);padding:6px 12px;border-radius:8px;color:var(--text)}" +
      ".tmr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".tmr-foot{font-size:12.5px;color:var(--muted);margin-top:12px;line-height:1.5}" +
      ".tmr-who span.tmr-rota{margin-top:2px}.tmr-link{border:0;background:none;color:var(--accent);font:inherit;font-weight:600;cursor:pointer;padding:0 4px;min-height:28px;text-decoration:underline;text-underline-offset:2px}.tmr-link:disabled{opacity:.55}" +
      ".tmr-roles{border:0;margin:0;padding:0}.tmr-roles legend{font-weight:600;margin-bottom:6px;padding:0}.tmr-r{display:flex;gap:10px;align-items:flex-start;padding:8px 0;min-height:44px;cursor:pointer}.tmr-r input{margin-top:3px;width:18px;height:18px;flex:0 0 auto}" +
      ".tmr-r span b{display:block;font-weight:600}.tmr-r span i{display:block;font-style:normal;font-size:13px;color:var(--muted);line-height:1.4}.tmr-plan{border-top:.5px solid var(--border);margin-top:4px;padding-top:12px}" +
      ".tmr-field{display:block}.tmr-field span{display:block;font-weight:600;margin-bottom:6px}.tmr-field select{width:100%;min-height:44px;font:inherit;font-size:16px;border-radius:10px;border:1px solid var(--border);background:var(--panel2);color:var(--text);padding:0 10px}" +
      "@media (max-width:600px){.tmr-link{min-height:44px}}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .fin-r-modal .eikon-btn.primary{color:#00160E}}" +
      "@media (max-width:600px){.tmr{padding:4px 16px 0}.tmr h1{font-size:28px}.tmr-form label>span{flex-basis:70px}.tmr-ferr{padding-left:96px}.tmr-btn{min-height:44px;border-radius:22px}}";
    document.head.appendChild(st);
  }

  function here() { return E.state.activeModuleId === ID; }
  function loadErr(e) {
    if (e && e.status === 404) { S.missing = true; return ""; }
    return e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the sign-ins");
  }
  async function load() {
    S.loading = true; S.error = ""; idle();
    try {
      var both = await Promise.all([E.apiFetch("/team/users", { method: "GET" }), E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }).catch(function () { return null; })]);
      var r = both[0], st = both[1];
      S.list = (r && r.users) || []; S.me = r.me; S.manageAdmins = !!r.admins_manage_admins; S.missing = false;
      // The rota people with who they sign in as (an older server sends no user_id: no rota line is shown).
      S.rota = st && st.ok && Array.isArray(st.staff) && ("can_plan" in st) ? st.staff : null;
    } catch (e) { S.error = loadErr(e); }
    S.loading = false; idle();
  }
  function idle() { if (!S.mount) return; if (E.whenFormIdle) E.whenFormIdle(S.mount, paint); else paint(); }

  function canChange(u) {
    if (String(u.id) === String(S.me)) return false;
    if (u.protected) return false;
    if (u.role === "admin" && !S.manageAdmins) return false;
    return true;
  }
  function whyNot(u) {
    if (String(u.id) === String(S.me)) return "You. Change your password in Settings.";
    if (u.protected) return "Eikon support's sign-in.";
    if (u.role === "admin" && !S.manageAdmins) return "Another admin: Eikon support changes it.";
    return "";
  }

  function row(u) {
    var busy = S.rowBusy[u.id], err = S.rowErr[u.id];
    var meta = [esc(u.email)];
    // When they last signed in comes first (Malta time), then how many devices are still signed in.
    if (!u.is_active) meta.push("Switched off" + (u.last_sign_in_at ? ", last signed in " + esc(when(u.last_sign_in_at)) : ""));
    else {
      meta.push(u.last_sign_in_at ? (signedToday(u) ? '<b class="tmr-today">Signed in ' + esc(when(u.last_sign_in_at)) + "</b>" : "Last signed in " + esc(when(u.last_sign_in_at))) : "Never signed in");
      if (u.signed_in_devices) meta.push("open on " + u.signed_in_devices + (u.signed_in_devices === 1 ? " device" : " devices"));
    }
    var pills = '<span class="tmr-pill' + (u.role === "admin" || u.is_pharmacist ? " a" : "") + '">' + esc(roleWord(u)) + '</span>' +
      (u.role !== "admin" && u.plans_rota && u.is_active ? '<span class="tmr-pill">Plans the rota</span>' : "") +
      (u.must_change_password && u.is_active ? '<span class="tmr-pill w">Has not chosen a password yet</span>' : "");
    // Where they are on the rota (one list of people: the rota row is linked to the sign-in, nothing is merged).
    var rotaLine = "";
    if (S.rota && u.is_active && !u.protected) {
      var rp = rotaOf(u), cand = rp ? null : (rotaByEmail(u) || (rotaByName(u).length === 1 ? rotaByName(u)[0] : null));
      rotaLine = '<span class="tmr-rota">' + (rp ? "On the rota as " + esc(rp.full_name) + (Number(rp.is_active) === 0 ? " (not working here now)" : "") : cand ? "On the rota as " + esc(cand.full_name) + "? Not linked yet." : "Not on the rota") +
        ' <button class="tmr-link" data-act="rota" data-id="' + u.id + '"' + (busy ? " disabled" : "") + ' aria-label="' + (rp ? "Change the rota link for " : "Link to the rota: ") + esc(u.full_name || u.email) + '">' + (rp ? "Change" : cand ? "Link" : "Link or add") + "</button></span>";
    }
    var acts = "";
    if (canChange(u)) {
      if (u.is_active) acts += '<button class="tmr-btn" data-act="reset" data-id="' + u.id + '"' + (busy ? " disabled" : "") + ' aria-label="New temporary password for ' + esc(u.full_name) + '">New password</button>' +
        '<button class="tmr-btn red" data-act="off" data-id="' + u.id + '"' + (busy ? " disabled" : "") + ' aria-label="Switch off ' + esc(u.full_name) + '">Switch off</button>';
      else acts += '<button class="tmr-btn" data-act="on" data-id="' + u.id + '"' + (busy ? " disabled" : "") + ' aria-label="Switch on ' + esc(u.full_name) + '">Switch on</button>';
      if (u.is_active) acts += '<button class="tmr-btn" data-act="role" data-id="' + u.id + '"' + (busy ? " disabled" : "") + ' aria-label="Role of ' + esc(u.full_name || u.email) + '">Role…</button>';
    } else acts = '<span class="tmr-note">' + esc(whyNot(u)) + '</span>';
    return '<div class="tmr-row' + (u.is_active ? "" : " off") + '" data-user="' + u.id + '"><div class="tmr-who"><b>' + esc(u.full_name || u.email) + pills + '</b><span>' + meta.join(" · ") + '</span>' + rotaLine +
      (err ? '<span style="color:var(--danger)" role="alert">' + esc(err) + '</span>' : "") + '</div><div class="tmr-acts">' + acts + '</div></div>';
  }

  // Today first: who signed in today, earliest first (who opened up), then everyone else in the server's order (by name).
  function ordered(list) {
    var today = [], rest = [];
    list.forEach(function (u) { (signedToday(u) ? today : rest).push(u); });
    today.sort(function (a, b) { return String(a.last_sign_in_at).localeCompare(String(b.last_sign_in_at)); });
    return today.concat(rest);
  }
  function peopleHtml() {
    var q = fold(S.q).trim(), all = S.list || [];
    var hit = q ? all.filter(function (u) { var h = fold((u.full_name || "") + " " + (u.email || "")); return q.split(/\s+/).every(function (w) { return h.indexOf(w) >= 0; }); }) : all;
    var on = ordered(hit.filter(function (u) { return u.is_active; })), off = hit.filter(function (u) { return !u.is_active; });
    var allOn = all.filter(function (u) { return u.is_active; }), nToday = allOn.filter(signedToday).length;
    if (q && !hit.length) return '<div class="tmr-quiet" role="status">Nobody here matches “' + esc(S.q.trim()) + '”. <button class="tmr-btn" data-act="q-clear">Show everyone</button></div>';
    var h = '<div class="tmr-lab">Can sign in · ' + on.length + (allOn.length ? '<span class="tmr-lab2"> · ' + nToday + ' signed in today</span>' : "") + '</div><div class="tmr-list">' + (on.length ? on.map(row).join("") : '<div class="tmr-row">Nobody.</div>') + '</div>';
    if (off.length) h += '<div class="tmr-lab">Switched off · ' + off.length + '</div><div class="tmr-list">' + off.map(row).join("") + '</div>';
    return h;
  }
  // A search changes only the list: the box is never rebuilt under the fingers.
  function paintPeople() { var box = S.mount && S.mount.querySelector("#tmr-people"); if (!box) return paint(); box.innerHTML = peopleHtml(); bindIn(box); }

  // An error under its own field, tied to it for screen readers.
  function ferr(k) { return S.fieldErr[k] ? ' aria-invalid="true" aria-describedby="tmr-ferr-' + k + '"' : ""; }
  function ferrText(k) { return S.fieldErr[k] ? '<span class="tmr-ferr" id="tmr-ferr-' + k + '" role="alert">' + esc(S.fieldErr[k]) + "</span>" : ""; }
  function keep() {
    var m = S.mount; if (!m) return;
    var n = m.querySelector("#tmr-name"), e = m.querySelector("#tmr-email"), r = m.querySelector("#tmr-role");
    if (n) S.add.name = n.value; if (e) S.add.email = e.value; if (r) S.add.role = r.value;
  }

  function paint() {
    var m = S.mount; if (!m || !here()) return;
    keep();
    var qn = m.querySelector("#tmr-q"); if (qn) S.q = qn.value;
    var focusId = document.activeElement && m.contains(document.activeElement) ? document.activeElement.id : "";
    var h = '<div class="tmr"><button class="tmr-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel(ID) : "‹ Team") + '</button><div class="tmr-top"><div><h1>People who sign in</h1>' +
      '<p class="tmr-sub">Everyone at ' + esc((E.state.user && E.state.user.location_name) || "this pharmacy") + ' signs in as themselves, so the registers show who did what.</p></div>';
    if (!isAdmin()) {
      // Who to ask, by name (GET /team/me: this pharmacy's admins, read once per sign-in) — roles round
      var ad = (E.rights && Array.isArray(E.rights.admins) && E.rights.admins) || [];
      var ask = ad.length ? "Ask " + (ad.length === 1 ? ad[0] + ", the admin." : ad.slice(0, -1).join(", ") + " or " + ad[ad.length - 1] + ", the admins.") : "Ask the pharmacy\'s admin.";
      m.innerHTML = h + '</div><div class="tmr-quiet">Only the pharmacy\'s admin can add people or change sign-ins. ' + esc(ask) + '</div></div>';
      bind();
      if (!E.rights && E.loadRights && !S.rightsAsked) { S.rightsAsked = true; E.loadRights().then(function () { if (here()) paint(); }); }
      return;
    }
    if (!S.missing && !S.adding && !S.shown) h += '<button class="tmr-btn p" data-act="add">Add a person</button>';
    h += '</div>';
    if (S.missing) {
      m.innerHTML = h + '<div class="tmr-quiet">This needs the next Eikon server update. Until then, Eikon support adds people and resets passwords.</div></div>';
      bind(); return;
    }
    if (S.shown) {
      h += '<div class="tmr-once" role="status" aria-live="polite"><h2>' + esc(S.shown.title) + '</h2>' +
        '<p>Give this temporary password to <b>' + esc(S.shown.name) + '</b> in person. They sign in with <b>' + esc(S.shown.email) + '</b> and choose their own password straight away.</p>' +
        '<div class="tmr-pw"><code id="tmr-temp">' + esc(S.shown.password) + '</code><button class="tmr-btn" data-act="copy">Copy</button></div>' +
        '<p>It is shown only now. If it is lost, give them a new one.</p>' +
        '<div style="display:flex;justify-content:flex-end"><button class="tmr-btn p" data-act="done" id="tmr-done">Done</button></div></div>';
    }
    if (S.adding) {
      h += '<form class="tmr-form" id="tmr-add" novalidate><div class="t">Add a person</div>' +
        '<label><span>Name</span><input id="tmr-name" autocomplete="off" autocapitalize="words" value="' + esc(S.add.name) + '" placeholder="Their full name"' + ferr("name") + '></label>' + ferrText("name") +
        '<label><span>E-mail</span><input id="tmr-email" type="email" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="email" value="' + esc(S.add.email) + '" placeholder="They sign in with this"' + ferr("email") + '></label>' + ferrText("email") +
        '<label><span>Role</span><select id="tmr-role">' + [["staff", "Staff"], ["pharmacist", "Pharmacist"], ["admin", "Admin (adds people, changes settings)"]].map(function (o) { return '<option value="' + o[0] + '"' + (S.add.role === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></label>' +
        (S.addErr ? '<div class="tmr-err" role="alert">' + esc(S.addErr) + '</div>' : "") +
        '<div class="acts"><button type="button" class="tmr-btn" data-act="add-cancel">Cancel</button><button type="submit" class="tmr-btn p"' + (S.addSaving ? " disabled" : "") + '>' + (S.addSaving ? "Adding…" : "Add") + '</button></div></form>';
    }
    if (S.error) h += '<div class="tmr-quiet" role="alert">' + esc(S.error) + ' <button class="tmr-btn" data-act="retry">Try again</button></div>';
    if (S.list) {
      if (S.list.length >= SEARCH_FROM) h += '<input class="tmr-q" id="tmr-q" type="search" autocomplete="off" spellcheck="false" aria-label="Find a person by name or e-mail" aria-controls="tmr-people" placeholder="Find a person" value="' + esc(S.q) + '">';
      h += '<div id="tmr-people">' + peopleHtml() + '</div>';
      h += '<p class="tmr-foot"><b>Admin</b> adds people, changes sign-ins and the pharmacy\'s settings, and plans the rota. <b>Pharmacist</b> does what staff do, signs off the registers each month and corrects a wrong register line (saying why); ' +
        '“the pharmacist” on other screens means an admin or a pharmacist. <b>Staff</b> record and read everything else and ask for leave; with <b>Plans the rota</b> they also change shifts and answer other people\'s leave. ' +
        'Every change is in the Audit trail.</p>'; // what Switch off and New password do is said in their own question
    } else if (S.loading && !S.error) h += '<div class="tmr-list" role="status" aria-label="Loading the sign-ins" style="margin-top:20px">' + '<div class="tmr-sk"><i></i><i></i></div>'.repeat(3) + '</div>'; // the shape of the list, not a spinner
    h += '</div>';
    m.innerHTML = h;
    bind();
    if (focusId) { var f = document.getElementById(focusId); if (f) f.focus(); }
  }

  function bindIn(root) {
    root.querySelectorAll("[data-act]").forEach(function (b) {
      if (b.tagName === "FORM") return;
      b.addEventListener("click", function (ev) { act(b.getAttribute("data-act"), b.getAttribute("data-id"), ev); });
    });
  }
  function bind() {
    var m = S.mount; if (!m) return;
    bindIn(m);
    var qi = m.querySelector("#tmr-q");
    if (qi) {
      qi.addEventListener("input", function () { S.q = qi.value; paintPeople(); });
      qi.addEventListener("keydown", function (e) { if (e.key === "Escape" && qi.value) { e.preventDefault(); qi.value = ""; S.q = ""; paintPeople(); } });
    }
    var f = m.querySelector("#tmr-add");
    if (f) {
      f.addEventListener("submit", function (e) { e.preventDefault(); create(); });
      f.addEventListener("keydown", function (e) { if (e.key === "Escape" && !S.addSaving) { e.preventDefault(); act("add-cancel"); } }); // Escape closes, as everywhere
    }
  }

  function byId(id) { return (S.list || []).filter(function (u) { return String(u.id) === String(id); })[0]; }

  function act(a, id, ev) {
    if (a === "back") { window.location.hash = E.ui2BackHash ? E.ui2BackHash(ID) : "#team"; return; }
    if (a === "retry") { load(); return; }
    if (a === "q-clear") { S.q = ""; var qi = S.mount && S.mount.querySelector("#tmr-q"); if (qi) { qi.value = ""; qi.focus(); } paintPeople(); return; }
    if (a === "add") { S.adding = true; S.addErr = ""; S.fieldErr = {}; paint(); var n = document.getElementById("tmr-name"); if (n) n.focus(); return; }
    if (a === "add-cancel") { S.adding = false; S.add = { name: "", email: "", role: "staff" }; S.addErr = ""; S.fieldErr = {}; paint(); focusAdd(); return; }
    if (a === "copy") { copy(); return; }
    if (a === "done") { S.shown = null; paint(); focusAdd(); return; }
    var u = byId(id); if (!u) return;
    if (a === "reset") confirmThen("Give " + (u.full_name || u.email) + " a new password?", "They are signed out of every device now and sign in again with a temporary password you will see once.", "New password", false, function () { reset(u); });
    if (a === "off") confirmThen("Switch off " + (u.full_name || u.email) + "?", "They are signed out of every device now and cannot sign in until you switch them on again. What they recorded stays, with their name.", "Switch off", true, function () { setActive(u, false); });
    if (a === "on") setActive(u, true);
    if (a === "role") roleDialog(u);
    if (a === "rota") rotaDialog(u);
  }

  // The shared dialog's primary button in dark mode: dark text on the green, as every primary button in the content
  // (app.css 1072 covers .eikon-content only, not the dialog). Marked on the dialog element itself (fin-r-).
  function darkSafe() { try { var d = document.querySelector(".eikon-modal"); if (d) d.classList.add("fin-r-modal"); } catch (e) {} } // called right after E.modal.show
  function confirmThen(title, text, label, danger, fn) {
    E.modal.show(title, '<p style="margin:0;line-height:1.5">' + esc(text) + '</p>', [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      { label: label, primary: !danger, danger: !!danger, onClick: function () { E.modal.hide(); fn(); } }
    ]);
    darkSafe();
    try { var bs = document.querySelectorAll("#eikon-modal-actions button"); if (bs[0]) bs[0].focus(); } catch (e) {}
  }

  function failText(x) {
    if (x && x.network) return "Not done: can't reach the server. Try again.";
    return String((x && (x.message || x)) || "Not done");
  }

  async function create() {
    keep();
    var name = S.add.name.trim(), email = S.add.email.trim().toLowerCase();
    // Every problem at once, each under its own field; focus goes to the first.
    S.fieldErr = {}; S.addErr = "";
    if (!name) S.fieldErr.name = "Write the person's name.";
    if (!email) S.fieldErr.email = "Write the e-mail they will sign in with.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) S.fieldErr.email = "That e-mail looks incomplete. Check it, for example karl@pharmacy.mt.";
    if (S.fieldErr.name || S.fieldErr.email) { paint(); var bad = document.getElementById(S.fieldErr.name ? "tmr-name" : "tmr-email"); if (bad) bad.focus(); return; }
    if (S.addSaving) return;
    S.addSaving = true; S.addErr = ""; paint();
    try {
      var r = await E.apiFetch("/team/users", { method: "POST", body: JSON.stringify({ email: email, full_name: name, role: S.add.role === "admin" || S.add.role === "pharmacist" ? S.add.role : "staff" }) });
      if (!r || !r.ok || !r.temporary_password) throw new Error((r && r.error) || "Not added");
      S.shown = { title: name + " can sign in", name: name, email: email, password: r.temporary_password };
      S.adding = false; S.add = { name: "", email: "", role: "staff" }; S.addSaving = false; S.fieldErr = {};
      showOnce();
      await load();
      return;
    } catch (x) { S.addErr = failText(x); }
    S.addSaving = false; paint();
  }
  function focusAdd() { var b = S.mount && S.mount.querySelector('[data-act="add"]'); if (b) b.focus(); }
  function showOnce() { paint(); var d = document.getElementById("tmr-done"); if (d) d.focus(); } // focus on Done: a repaint keeps it there

  async function reset(u) {
    S.rowBusy[u.id] = true; S.rowErr[u.id] = ""; paint();
    try {
      var r = await E.apiFetch("/team/users/" + encodeURIComponent(u.id) + "/password", { method: "POST", body: "{}" });
      if (!r || !r.ok || !r.temporary_password) throw new Error((r && r.error) || "Not done");
      S.shown = { title: "New password for " + (u.full_name || u.email), name: u.full_name || u.email, email: u.email, password: r.temporary_password };
      delete S.rowBusy[u.id];
      showOnce();
      await load();
    } catch (x) { S.rowErr[u.id] = failText(x); delete S.rowBusy[u.id]; paint(); }
  }

  async function setActive(u, on) {
    S.rowBusy[u.id] = true; S.rowErr[u.id] = ""; paint();
    try {
      var r = await E.apiFetch("/team/users/" + encodeURIComponent(u.id) + "/active", { method: "POST", body: JSON.stringify({ active: !!on }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Not done");
      E.toast(on ? (u.full_name || u.email) + " can sign in again." : (u.full_name || u.email) + " is switched off and signed out everywhere.", "success");
      delete S.rowBusy[u.id];
      await load();
    } catch (x) { S.rowErr[u.id] = failText(x); delete S.rowBusy[u.id]; paint(); }
  }

  // Role…: Staff / Pharmacist / Admin, and "Plans the rota" for a staff or pharmacist sign-in. Only what changed is sent.
  var ROLE_TEXT = { staff: "Records and reads the registers, asks for leave.", pharmacist: "What staff do, plus the month sign-off and correcting a wrong register line.", admin: "Everything: adds people, changes sign-ins and settings, plans the rota." };
  function roleDialog(u) {
    var cur = roleKey(u), name = u.full_name || u.email;
    var body = '<fieldset class="tmr-roles"><legend>Role</legend>' + ["staff", "pharmacist", "admin"].map(function (k) {
      return '<label class="tmr-r"><input type="radio" name="tmr-role-pick" value="' + k + '"' + (k === cur ? " checked" : "") + "><span><b>" + { staff: "Staff", pharmacist: "Pharmacist", admin: "Admin" }[k] + "</b><i>" + esc(ROLE_TEXT[k]) + "</i></span></label>";
    }).join("") + "</fieldset>" +
      '<label class="tmr-r tmr-plan"><input type="checkbox" id="tmr-plan"' + (u.plans_rota ? " checked" : "") + '><span><b>Plans the rota</b><i>Changes shifts and answers other people\'s leave. Nobody but an admin answers their own.</i></span></label>' +
      (cur !== "admin" ? '<p class="tmr-note" style="margin:10px 0 0">Once someone is an admin, only Eikon support can change their sign-in.</p>' : "");
    E.modal.show(name, body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      { label: "Save", primary: true, onClick: function () {
        var pick = document.querySelector('input[name="tmr-role-pick"]:checked'), pl = document.getElementById("tmr-plan");
        var role = pick ? pick.value : cur, plan = !!(pl && pl.checked);
        E.modal.hide(); saveRole(u, role, plan);
      } }
    ]);
    darkSafe();
    // the rota right only means something for staff and pharmacists
    var sync = function () { var pick = document.querySelector('input[name="tmr-role-pick"]:checked'), pl = document.querySelector(".tmr-plan"); if (pl) pl.style.display = pick && pick.value === "admin" ? "none" : ""; };
    document.querySelectorAll('input[name="tmr-role-pick"]').forEach(function (r) { r.addEventListener("change", sync); }); sync();
    try { var f = document.querySelector('input[name="tmr-role-pick"]:checked'); if (f) f.focus(); } catch (e) {}
  }
  async function saveRole(u, role, plan) {
    var cur = roleKey(u);
    S.rowBusy[u.id] = true; S.rowErr[u.id] = ""; paint();
    try {
      if (role !== cur) {
        var body = role === "staff" ? { role: "staff", is_pharmacist: false } : { role: role };
        var r = await E.apiFetch("/team/users/" + encodeURIComponent(u.id) + "/role", { method: "POST", body: JSON.stringify(body) });
        if (!r || !r.ok) throw new Error((r && r.error) || "Not done");
      }
      if (role !== "admin" && plan !== !!u.plans_rota) {
        var r2 = await E.apiFetch("/team/users/" + encodeURIComponent(u.id) + "/rights", { method: "POST", body: JSON.stringify({ plans_rota: plan }) });
        if (!r2 || !r2.ok) throw new Error((r2 && r2.error) || "Not done");
      }
      var word = { staff: "staff", pharmacist: "a pharmacist", admin: "an admin" }[role];
      E.toast((u.full_name || u.email) + " is " + word + (role !== "admin" ? (plan ? " and plans the rota." : ".") : "."), "success");
      delete S.rowBusy[u.id];
      await load();
    } catch (x) { S.rowErr[u.id] = failText(x); delete S.rowBusy[u.id]; paint(); }
  }

  // The rota link: choose the rota person this sign-in is, or add them to the rota (the classic Add Employee body).
  function rotaDialog(u) {
    var name = u.full_name || u.email, cur = rotaOf(u), byE = rotaByEmail(u), byN = rotaByName(u);
    var free = (S.rota || []).filter(function (p) { return Number(p.is_active) !== 0 && (p.user_id == null || (cur && String(p.id) === String(cur.id))); });
    var first = [cur, byE].concat(byN).filter(Boolean), seen = {};
    var opts = first.concat(free).filter(function (p) { if (seen[p.id]) return false; seen[p.id] = true; return true; });
    var sel = cur ? String(cur.id) : byE ? String(byE.id) : byN.length === 1 ? String(byN[0].id) : opts.length ? "" : "new";
    var body = '<label class="tmr-field"><span>' + esc(name) + ' on the rota</span><select id="tmr-rota-pick">' +
      (sel === "" ? '<option value="" selected>Choose…</option>' : "") +
      opts.map(function (p) { return '<option value="' + p.id + '"' + (String(p.id) === sel ? " selected" : "") + ">" + esc(p.full_name) + (p.email ? " (" + esc(p.email) + ")" : "") + "</option>"; }).join("") +
      '<option value="new"' + (sel === "new" ? " selected" : "") + ">Add " + esc(name) + " to the rota</option>" +
      (cur ? '<option value="none">Not on the rota</option>' : "") + "</select></label>" +
      '<p class="tmr-note" style="margin:10px 0 0">This only links the two: names, shifts and leave stay as they are. ' + esc(name) + " then sees their own shifts and asks for leave as themselves.</p>";
    E.modal.show("On the rota", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      { label: "Save", primary: true, onClick: function () { var v = (document.getElementById("tmr-rota-pick") || {}).value || ""; if (!v) return; E.modal.hide(); saveRota(u, v, cur); } }
    ]);
    darkSafe();
    try { var f = document.getElementById("tmr-rota-pick"); if (f) f.focus(); } catch (e) {}
  }
  async function saveRota(u, v, cur) {
    S.rowBusy[u.id] = true; S.rowErr[u.id] = ""; paint();
    try {
      var sid = v, name = u.full_name || u.email;
      if (v === "none") sid = cur && cur.id;
      if (v === "new") {
        // The body Plan shifts › Who works here? sends (the classic Add Employee shape), with their sign-in e-mail.
        var nb = { full_name: name, designation: u.is_pharmacist ? "pharmacist" : "assistant", employment_type: "fulltime", contracted_hours: 40,
          email: u.email || "", phone: "", registration_number: "", is_active: 1, patterns_json: JSON.stringify({ patterns: [], provisionalId: null }) };
        var listP = async function () { var g = await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }); return (g && g.staff) || []; };
        var same = function (x) { return String(x.full_name) === name && String(x.email || "") === String(u.email || "") && x.user_id == null; };
        var c = await E.postOnce("/shifts/staff", nb, { list: listP, same: same });
        sid = c && c.staff_id;
        if (!sid) { var found = (await listP()).filter(same).pop(); sid = found && found.id; } // a retry after a lost answer
        if (!sid) throw new Error((c && c.error) || "Not added to the rota");
      }
      var r = await E.apiFetch("/shifts/staff/" + encodeURIComponent(sid) + "/link", { method: "POST", body: JSON.stringify({ user_id: v === "none" ? null : u.id }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Not linked");
      E.toast(v === "none" ? name + " is no longer linked to the rota." : v === "new" ? name + " is on the rota." : name + " is linked to the rota.", "success");
      delete S.rowBusy[u.id];
      await load();
    } catch (x) { S.rowErr[u.id] = failText(x); delete S.rowBusy[u.id]; paint(); }
  }

  function copy() {
    var t = S.shown && S.shown.password; if (!t) return;
    var okFn = function () { E.toast("Copied. Paste it only where they will see it.", "success"); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(okFn, function () { E.toast("Copy did not work here: read it out instead.", "warn"); }); return; }
    } catch (e) {}
    E.toast("Copy did not work here: read it out instead.", "warn");
  }

  async function render(ctx) {
    S.mount = ctx && ctx.mount;
    S.q = ""; S.shown = null; S.adding = false; S.addErr = ""; S.fieldErr = {}; S.rowBusy = {}; S.rowErr = {}; S.error = ""; S.missing = false;
    css();
    paint();
    if (isAdmin()) await load();
  }
  function destroy() { S.shown = null; S.list = null; } // the temporary password is never kept after leaving

  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf(ID) < 0) E.UI2_DESTINATIONS.push(ID);
  E.registerModule({ id: ID, title: "People who sign in", order: 3, icon: "◉", ui2Only: true, adminOnly: true, render: render, destroy: destroy });
})();
