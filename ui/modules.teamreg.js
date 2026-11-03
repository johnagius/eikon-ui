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
     POST /team/users/:id/role {role}        only when admins_manage_admins
   The temporary password lives only in this screen's memory until Done (or leaving the screen); never stored. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var ID = "teamreg";
  var S = { mount: null, list: null, me: null, manageAdmins: false, loading: false, error: "", missing: false,
    adding: false, add: { name: "", email: "", role: "staff" }, addErr: "", fieldErr: {}, addSaving: false, shown: null, rowBusy: {}, rowErr: {} };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function isAdmin() { var u = E.state.user; return !!(u && u.role === "admin"); }
  function when(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ""));
    return m ? Number(m[3]) + " " + MON[Number(m[2]) - 1] + " " + m[1] : "";
  }
  function roleWord(r) { return r === "admin" ? "Admin" : r === "staff" ? "Staff" : "Limited"; }

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
      ".tmr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px}" +
      ".tmr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".tmr-row{display:flex;align-items:center;gap:12px;min-height:60px;padding:10px 14px 10px 16px;border-top:.5px solid var(--border);flex-wrap:wrap}.tmr-row:first-child{border-top:0}" +
      ".tmr-row.off{opacity:.72}.tmr-who{flex:1;min-width:200px}.tmr-who b{display:block;font-size:15.5px;font-weight:600;overflow-wrap:anywhere}.tmr-who span{display:block;font-size:13px;color:var(--muted);overflow-wrap:anywhere}" +
      ".tmr-who .tmr-pill{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:9px;background:var(--bg);color:var(--muted);margin-left:6px;vertical-align:1px}.tmr-who .tmr-pill.a{color:var(--accent)}.tmr-who .tmr-pill.w{color:var(--danger)}" +
      ".tmr-acts{display:flex;gap:8px;flex-wrap:wrap}.tmr-note{font-size:12.5px;color:var(--muted)}" +
      ".tmr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:14px}" +
      ".tmr-form .t{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:8px 14px 4px}" +
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
      var r = await E.apiFetch("/team/users", { method: "GET" });
      S.list = (r && r.users) || []; S.me = r.me; S.manageAdmins = !!r.admins_manage_admins; S.missing = false;
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
    if (!u.is_active) meta.push("Switched off");
    else if (u.signed_in_devices) meta.push("Signed in on " + u.signed_in_devices + (u.signed_in_devices === 1 ? " device" : " devices") + (u.last_sign_in_at ? ", last " + esc(when(u.last_sign_in_at)) : ""));
    else meta.push(u.last_sign_in_at ? "Last signed in " + esc(when(u.last_sign_in_at)) : "Not signed in now");
    var pills = '<span class="tmr-pill' + (u.role === "admin" ? " a" : "") + '">' + roleWord(u.role) + '</span>' +
      (u.must_change_password && u.is_active ? '<span class="tmr-pill w">Has not chosen a password yet</span>' : "");
    var acts = "";
    if (canChange(u)) {
      if (u.is_active) acts += '<button class="tmr-btn" data-act="reset" data-id="' + u.id + '"' + (busy ? " disabled" : "") + ' aria-label="New temporary password for ' + esc(u.full_name) + '">New password</button>' +
        '<button class="tmr-btn red" data-act="off" data-id="' + u.id + '"' + (busy ? " disabled" : "") + ' aria-label="Switch off ' + esc(u.full_name) + '">Switch off</button>';
      else acts += '<button class="tmr-btn" data-act="on" data-id="' + u.id + '"' + (busy ? " disabled" : "") + ' aria-label="Switch on ' + esc(u.full_name) + '">Switch on</button>';
      if (S.manageAdmins && u.is_active) acts += '<button class="tmr-btn" data-act="role" data-id="' + u.id + '"' + (busy ? " disabled" : "") + '>' + (u.role === "admin" ? "Make staff" : "Make admin") + '</button>';
    } else acts = '<span class="tmr-note">' + esc(whyNot(u)) + '</span>';
    return '<div class="tmr-row' + (u.is_active ? "" : " off") + '" data-user="' + u.id + '"><div class="tmr-who"><b>' + esc(u.full_name || u.email) + pills + '</b><span>' + meta.join(" · ") + '</span>' +
      (err ? '<span style="color:var(--danger)" role="alert">' + esc(err) + '</span>' : "") + '</div><div class="tmr-acts">' + acts + '</div></div>';
  }

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
    var focusId = document.activeElement && m.contains(document.activeElement) ? document.activeElement.id : "";
    var h = '<div class="tmr"><button class="tmr-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel(ID) : "‹ Team") + '</button><div class="tmr-top"><div><h1>People who sign in</h1>' +
      '<p class="tmr-sub">Everyone at ' + esc((E.state.user && E.state.user.location_name) || "this pharmacy") + ' signs in as themselves, so the registers show who did what.</p></div>';
    if (!isAdmin()) {
      m.innerHTML = h + '</div><div class="tmr-quiet">Only the pharmacy\'s admin can add people or change sign-ins. Ask your pharmacist.</div></div>';
      bind(); return;
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
        '<label><span>Role</span><select id="tmr-role"><option value="staff"' + (S.add.role !== "admin" ? " selected" : "") + '>Staff</option>' +
        (S.manageAdmins ? '<option value="admin"' + (S.add.role === "admin" ? " selected" : "") + '>Admin (can manage sign-ins)</option>' : "") + '</select></label>' +
        (S.addErr ? '<div class="tmr-err" role="alert">' + esc(S.addErr) + '</div>' : "") +
        '<div class="acts"><button type="button" class="tmr-btn" data-act="add-cancel">Cancel</button><button type="submit" class="tmr-btn p"' + (S.addSaving ? " disabled" : "") + '>' + (S.addSaving ? "Adding…" : "Add") + '</button></div></form>';
    }
    if (S.error) h += '<div class="tmr-quiet" role="alert">' + esc(S.error) + ' <button class="tmr-btn" data-act="retry">Try again</button></div>';
    if (S.list) {
      var on = S.list.filter(function (u) { return u.is_active; }), off = S.list.filter(function (u) { return !u.is_active; });
      h += '<div class="tmr-lab">Can sign in · ' + on.length + '</div><div class="tmr-list">' + (on.length ? on.map(row).join("") : '<div class="tmr-row">Nobody.</div>') + '</div>';
      if (off.length) h += '<div class="tmr-lab">Switched off · ' + off.length + '</div><div class="tmr-list">' + off.map(row).join("") + '</div>';
      h += '<p class="tmr-foot">Switching someone off signs them out of every device at once; their name stays on everything they recorded. ' +
        'A new password signs them out too, and they choose their own at the next sign-in. Every change is in the Audit trail.</p>';
    } else if (S.loading && !S.error) h += '<div class="tmr-list" role="status" aria-label="Loading the sign-ins" style="margin-top:20px">' + '<div class="tmr-sk"><i></i><i></i></div>'.repeat(3) + '</div>'; // the shape of the list, not a spinner
    h += '</div>';
    m.innerHTML = h;
    bind();
    if (focusId) { var f = document.getElementById(focusId); if (f) f.focus(); }
  }

  function bind() {
    var m = S.mount; if (!m) return;
    m.querySelectorAll("[data-act]").forEach(function (b) {
      if (b.tagName === "FORM") return;
      b.addEventListener("click", function (ev) { act(b.getAttribute("data-act"), b.getAttribute("data-id"), ev); });
    });
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
    if (a === "add") { S.adding = true; S.addErr = ""; S.fieldErr = {}; paint(); var n = document.getElementById("tmr-name"); if (n) n.focus(); return; }
    if (a === "add-cancel") { S.adding = false; S.add = { name: "", email: "", role: "staff" }; S.addErr = ""; S.fieldErr = {}; paint(); focusAdd(); return; }
    if (a === "copy") { copy(); return; }
    if (a === "done") { S.shown = null; paint(); focusAdd(); return; }
    var u = byId(id); if (!u) return;
    if (a === "reset") confirmThen("Give " + (u.full_name || u.email) + " a new password?", "They are signed out of every device now and sign in again with a temporary password you will see once.", "New password", false, function () { reset(u); });
    if (a === "off") confirmThen("Switch off " + (u.full_name || u.email) + "?", "They are signed out of every device now and cannot sign in until you switch them on again. What they recorded stays, with their name.", "Switch off", true, function () { setActive(u, false); });
    if (a === "on") setActive(u, true);
    if (a === "role") confirmThen((u.role === "admin" ? "Make " : "Make ") + (u.full_name || u.email) + (u.role === "admin" ? " staff?" : " an admin?"), u.role === "admin" ? "They will no longer manage sign-ins or admin settings." : "Admins add people, change sign-ins and change the pharmacy's settings.", "Change", false, function () { setRole(u, u.role === "admin" ? "staff" : "admin"); });
  }

  function confirmThen(title, text, label, danger, fn) {
    E.modal.show(title, '<p style="margin:0;line-height:1.5">' + esc(text) + '</p>', [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      { label: label, primary: !danger, danger: !!danger, onClick: function () { E.modal.hide(); fn(); } }
    ]);
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
      var r = await E.apiFetch("/team/users", { method: "POST", body: JSON.stringify({ email: email, full_name: name, role: S.add.role === "admin" ? "admin" : "staff" }) });
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

  async function setRole(u, role) {
    S.rowBusy[u.id] = true; S.rowErr[u.id] = ""; paint();
    try {
      var r = await E.apiFetch("/team/users/" + encodeURIComponent(u.id) + "/role", { method: "POST", body: JSON.stringify({ role: role }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Not done");
      E.toast((u.full_name || u.email) + (role === "admin" ? " is now an admin." : " is now staff."), "success");
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
    S.shown = null; S.adding = false; S.addErr = ""; S.fieldErr = {}; S.rowBusy = {}; S.rowErr = {}; S.error = ""; S.missing = false;
    css();
    paint();
    if (isAdmin()) await load();
  }
  function destroy() { S.shown = null; S.list = null; } // the temporary password is never kept after leaving

  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf(ID) < 0) E.UI2_DESTINATIONS.push(ID);
  E.registerModule({ id: ID, title: "People who sign in", order: 3, icon: "◉", ui2Only: true, adminOnly: true, render: render, destroy: destroy });
})();
