/* Handover, new layout: what yesterday's team left for today (most critical first), the standing instructions, today's
   notes, and what today leaves for tomorrow (add a point, mark it Low / Medium / Critical, remove one).
   The day's record is replaced whole on every save and deleted if left empty (UPDATE-AUDIT.md), so every save first
   reads the day afresh and changes only the one thing asked: a point added or removed by someone else on another
   till is kept. Notes edited elsewhere since you opened them are never overwritten: theirs are shown instead.
   The standing instructions ("Always") are changed here too, with the classic Instructions screen's call: PUT
   /instructions/global with the whole set, read afresh just before, and only permanent_handover changed.
   Other days, and the opening, closing and how-to instructions, stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, ymd: "", incoming: [], mine: null, standing: "", loading: false, error: "", sev: "g", draft: "", notes: null, notesBase: "", saving: false, err: "", warn: "", fromYmd: "", std: null, stdBusy: false, stdMsg: "" };
  var SEV = { r: ["Critical", 0], y: ["Medium", 1], g: ["Low", 2] };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return ymdOf(new Date()); }
  function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return ymdOf(d); }
  var WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // "From yesterday", or the weekday of the last day that left something (a Monday after a closed Sunday shows Saturday's).
  function fromLabel() { if (!S.fromYmd || S.fromYmd === daysAgo(1)) return "From yesterday"; var p = S.fromYmd.split("-"); return "From " + WD[new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()]; }
  function dirty() { return (S.notes || "") !== (S.notesBase || ""); }
  function bySev(a, b) { return (SEV[a.sev] || SEV.g)[1] - (SEV[b.sev] || SEV.g)[1]; }
  // The classic Instructions screen's normalizeState, for the global set only (modules.instructions.js): every section
  // it knows is there with a text and an updated_at (HIV and Concerta also with enabled), other keys are kept as they
  // are. The new screen sends exactly the object the classic screen would send.
  var GLOBAL_KEYS = ["opening", "closing", "endofday", "pos", "poyc", "ordering", "loyalty", "hiv", "concerta", "doctors_process", "doctors_fees", "clinic_fees", "permanent_handover"];
  function normGlobal(g) {
    var s = g && typeof g === "object" ? g : {};
    GLOBAL_KEYS.forEach(function (k) {
      if (!s[k] || typeof s[k] !== "object") s[k] = {};
      if (k === "hiv" || k === "concerta") { if (typeof s[k].enabled !== "boolean") s[k].enabled = false; }
      if (typeof s[k].text !== "string") s[k].text = "";
      if (typeof s[k].updated_at !== "string") s[k].updated_at = "";
    });
    return s;
  }
  function clean(rec) { return { notes: String((rec && rec.notes) || ""), handover_out: Array.isArray(rec && rec.handover_out) ? rec.handover_out : [] }; }

  function css() {
    if (document.getElementById("eikon-hndreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-hndreg-css";
    st.textContent =
      ".hnd{max-width:880px;margin:0 auto}" +
      ".hnd-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;min-height:44px;padding:0 12px 0 0;margin:-8px 0 -6px;cursor:pointer}" +
      ".hnd h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.hnd-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".hnd-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".hnd-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.hnd-btn:disabled{opacity:.55;cursor:default}.hnd-btn.x{border:0;background:none;color:var(--muted);height:28px;padding:0 6px}" +
      ".hnd-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:22px 2px 7px;display:flex;gap:8px}.hnd-lab b{color:var(--text)}" +
      ".hnd-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".hnd-pt{display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-top:.5px solid var(--border);font-size:15px;line-height:1.35}.hnd-pt:first-child{border-top:0}.hnd-pt .t{flex:1;min-width:0;white-space:pre-wrap}" +
      ".hnd-dot{flex:0 0 9px;height:9px;border-radius:50%;margin-top:6px;background:var(--ok)}.hnd-dot.y{background:#E0A100}.hnd-dot.r{background:var(--danger)}" +
      ".hnd-pt small{display:block;font-size:12px;color:var(--muted);font-weight:700}.hnd-pt.r small{color:var(--danger)}" +
      ".hnd-box{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:15px;white-space:pre-wrap;line-height:1.4}" +
      ".hnd-ta{width:100%;box-sizing:border-box;min-height:96px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:12px 14px;outline:0;resize:vertical}" +
      ".hnd-row{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}.hnd-in{flex:1;min-width:180px;height:40px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0}" +
      ".hnd-seg{display:flex;gap:4px}.hnd-seg button{font:inherit;font-size:13px;font-weight:600;height:32px;padding:0 10px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer}" +
      ".hnd-seg button.on{color:#fff}.hnd-seg button.on[data-sev=g]{background:var(--ok);border-color:var(--ok)}.hnd-seg button.on[data-sev=y]{background:#C98A12;border-color:#C98A12}.hnd-seg button.on[data-sev=r]{background:var(--danger);border-color:var(--danger)}" +
      ".hnd-err{color:var(--danger);font-size:13px;margin-top:6px}.hnd-warn{font-size:13.5px;margin-top:8px;padding:10px 12px;border-radius:10px;background:rgba(201,138,18,.12)}" +
      ".hnd-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:12px;padding:16px;color:var(--muted)}.hnd-quiet .hnd-btn{display:block;margin-top:12px}" +
      ".hnd-dirty{font-size:13px;color:var(--muted);margin-right:auto}" +
      ".hnd-lab .hnd-ch{margin-left:auto;text-transform:none;letter-spacing:0;font-size:13px;font-weight:600;color:var(--accent);border:0;background:none;font-family:inherit;cursor:pointer;padding:0 2px;min-height:24px}" +
      ".hnd-addstd{display:block;width:100%;text-align:left;font:inherit;font-size:14.5px;font-weight:600;color:var(--accent);background:var(--panel2);border:1px dashed var(--border);border-radius:12px;padding:11px 14px;cursor:pointer;min-height:44px;margin-top:22px}" +
      ".hnd-sk{height:120px;margin-top:22px;border-radius:12px;background:rgba(118,118,128,.1)}.hnd-sk+.hnd-sk{height:96px}" +
      ".hnd-foot{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.6}.hnd-foot a{color:var(--accent)}" +
      "@media (max-width:600px){.hnd{padding:4px 16px 0}.hnd h1{font-size:32px}.hnd-btn{height:44px;border-radius:22px}.hnd-btn.x{height:44px;padding:0 10px}.hnd-in{height:44px}.hnd-seg button{height:44px;padding:0 12px}.hnd-foot a{display:inline-block;padding:12px 0;margin:-12px 0}.hnd-lab .hnd-ch{min-height:44px;margin:-12px 0 -12px auto;padding:0 4px}}";
    document.head.appendChild(st);
  }

  async function day(ymd) {
    var r = await E.apiFetch("/instructions/daily?ymd=" + encodeURIComponent(ymd), { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the handover");
    return clean(r.record);
  }
  async function load(opts) {
    var quiet = opts && opts.quiet && S.mine; // after a save: if the re-read fails, keep what is on screen (and what was typed)
    S.loading = true; if (!quiet) { S.error = ""; paint(); }
    try {
      var res = await Promise.all([day(daysAgo(1)), day(S.ymd), E.apiFetch("/instructions/global", { method: "GET" }).catch(function () { return null; })]);
      // Nothing from yesterday (a closed Sunday, a holiday): the last day that left something, up to four days back.
      var inc = res[0].handover_out, from = daysAgo(1);
      for (var back = 2; !inc.length && back <= 4; back++) { var r0 = await day(daysAgo(back)); if (r0.handover_out.length) { inc = r0.handover_out; from = daysAgo(back); } }
      S.fromYmd = from;
      S.incoming = inc.slice().sort(bySev);
      S.mine = res[1];
      if (S.notes == null) { S.notes = S.mine.notes; S.notesBase = S.mine.notes; }
      var g = res[2] && res[2].ok && res[2].global; S.standing = g && g.permanent_handover && g.permanent_handover.text ? String(g.permanent_handover.text) : "";
      S.stdRead = !!(res[2] && res[2].ok); // the standing instructions could not be read: they are not offered for change
    } catch (e) { if (!quiet) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the handover"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function pt(b, removable) {
    var sev = SEV[b.sev] ? b.sev : "g";
    return '<div class="hnd-pt ' + sev + '"><span class="hnd-dot ' + sev + '"></span><div class="t">' + (sev !== "g" ? "<small>" + SEV[sev][0] + "</small>" : "") + esc(b.text) + "</div>" +
      (removable ? '<button class="hnd-btn x" data-act="rm" data-id="' + esc(b.id) + '" aria-label="' + esc("Remove: " + b.text) + '">Remove</button>' : "") + "</div>";
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "hndreg") return; // left before a reply came back: do not draw over the next screen
    var ta = m.querySelector("#hnd-notes"); if (ta && !fromState) S.notes = ta.value; // typing survives every repaint
    var inp = m.querySelector("#hnd-new"); if (inp) S.draft = inp.value;
    var sta = m.querySelector("#hnd-std"); if (sta && S.std && !fromState) S.std.text = sta.value;
    var h = '<div class="hnd"><button class="hnd-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("hndreg") : "‹ Team") + '</button><h1>Handover</h1><p class="hnd-sub">What the last shift left you, and what you leave the next one.</p>';
    if (S.error) h += '<div class="hnd-quiet" style="margin-top:16px" role="alert">' + esc(S.error) + '<button class="hnd-btn" data-act="retry">Try again</button></div>';
    else if (!S.mine) h += '<div role="status" aria-label="Opening the handover"><div class="hnd-sk"></div><div class="hnd-sk"></div></div>'; // the shape of the page, not a spinner
    else {
      h += '<h2 class="hnd-lab">' + esc(fromLabel()) + " <b>" + S.incoming.length + "</b></h2>" + (S.incoming.length ? '<div class="hnd-list">' + S.incoming.map(function (b) { return pt(b, false); }).join("") + "</div>" : '<div class="hnd-quiet">Nothing was handed over in the last few days.</div>');
      h += stdHtml();
      h += '<h2 class="hnd-lab"><label for="hnd-notes">Today\'s notes</label></h2><textarea class="hnd-ta" id="hnd-notes" aria-describedby="hnd-dirty" placeholder="Anything for today\'s team">' + esc(S.notes || "") + "</textarea>" +
        (S.warn ? '<div class="hnd-warn" role="alert">' + esc(S.warn) + "</div>" : "") +
        '<div class="hnd-row" style="justify-content:flex-end"><span class="hnd-dirty" id="hnd-dirty" aria-live="polite">' + (dirty() ? "Not saved yet" : "") + '</span><button class="hnd-btn p" data-act="notes" title="Save notes (Ctrl+Enter)"' + (S.saving || !dirty() ? " disabled" : "") + ">Save notes</button></div>";
      var out = S.mine.handover_out.slice().sort(bySev);
      h += '<h2 class="hnd-lab"><label for="hnd-new">For tomorrow</label> <b>' + out.length + "</b></h2>" + (out.length ? '<div class="hnd-list">' + out.map(function (b) { return pt(b, true); }).join("") + "</div>" : "") +
        '<form class="hnd-row" id="hnd-add" autocomplete="off"><input class="hnd-in" id="hnd-new" enterkeyhint="done" placeholder="e.g. Call Mrs Borg about her insulin" value="' + esc(S.draft) + '">' +
        '<div class="hnd-seg" role="group" aria-label="How urgent">' + ["g", "y", "r"].map(function (k) { return '<button type="button" data-sev="' + k + '" aria-pressed="' + (S.sev === k) + '" class="' + (S.sev === k ? "on" : "") + '">' + SEV[k][0] + "</button>"; }).join("") + "</div>" +
        '<button type="submit" class="hnd-btn p"' + (S.saving ? " disabled" : "") + ">Add</button></form>" +
        (S.err ? '<div class="hnd-err" role="alert">' + esc(S.err) + "</div>" : "");
    }
    h += '<p class="hnd-foot">Another day\'s handover, and the opening, closing and how-to instructions, are in the <a href="#" data-act="classic">classic screen</a>.</p></div>';
    m.innerHTML = h;
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("hndreg") : "#team";
        else if (act === "retry") load();
        else if (act === "notes") saveNotes();
        else if (act === "rm") change(function (rec) { var id = b.getAttribute("data-id"); rec.handover_out = rec.handover_out.filter(function (x) { return String(x.id) !== id; }); }, "Removed").then(function () { var i = S.mount && S.mount.querySelector("#hnd-new"); if (i && !document.activeElement.closest("form, textarea")) i.focus(); });
        else if (act === "std") { S.std = { text: S.standing, base: S.standing, err: "", warn: "" }; S.stdMsg = ""; paint(); var ta2 = S.mount && S.mount.querySelector("#hnd-std"); if (ta2) { ta2.focus(); try { ta2.setSelectionRange(ta2.value.length, ta2.value.length); } catch (e2) {} } }
        else if (act === "std-cancel") closeStd();
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "hndreg"); } catch (x) {} E.openClassic("instructions"); }
      });
    });
    m.querySelectorAll(".hnd-seg [data-sev]").forEach(function (b) { b.addEventListener("click", function () { S.sev = b.getAttribute("data-sev"); paint(); var again = S.mount && S.mount.querySelector('.hnd-seg [data-sev="' + S.sev + '"]'); if (again) again.focus(); }); });
    var t = m.querySelector("#hnd-notes"); if (t) {
      t.addEventListener("input", function () { S.notes = t.value; var btn = m.querySelector('[data-act="notes"]'); if (btn) btn.disabled = S.saving || !dirty(); var d = m.querySelector("#hnd-dirty"), w = dirty() ? "Not saved yet" : ""; if (d && d.textContent !== w) d.textContent = w; });
      t.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && !S.saving && dirty()) { ev.preventDefault(); saveNotes(); } }); // Ctrl+Enter saves; Enter is a new line
    }
    var sf = m.querySelector("#hnd-stdf"); if (sf) {
      sf.addEventListener("input", function (ev) { if (S.std && ev.target && ev.target.id === "hnd-std") S.std.text = ev.target.value; }); // kept on leaving and coming back
      sf.addEventListener("submit", function (ev) { ev.preventDefault(); saveStd(); });
      sf.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape" && !S.stdBusy) { ev.preventDefault(); ev.stopPropagation(); closeStd(); }
        else if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && !S.stdBusy) { ev.preventDefault(); saveStd(); } // Ctrl+Enter saves; Enter is a new line
      });
    }
    var f = m.querySelector("#hnd-add"); if (f) f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var text = String((m.querySelector("#hnd-new") || {}).value || "").trim(); S.draft = text;
      if (!text) { S.err = "Write the point for tomorrow. Nothing was saved."; return paint(); }
      var sev = S.sev;
      change(function (rec) { rec.handover_out = rec.handover_out.concat([{ id: "b_" + Date.now() + "_" + String(Math.random()).slice(2), sev: sev, text: text, created_at: new Date().toISOString() }]); }, "Added for tomorrow", function () { S.draft = ""; var i = S.mount && S.mount.querySelector("#hnd-new"); if (i) i.value = ""; });
    });
  }

  // ---- The standing instructions ("Always"): shown to every shift; changed in place ----
  function stdHtml() {
    var d = S.std;
    if (!d) {
      if (S.standing) return '<h2 class="hnd-lab"><span id="hnd-std-l">Always</span>' + (S.stdRead ? '<button class="hnd-ch" data-act="std" aria-label="Change the standing instructions">Change</button>' : "") + '</h2><div class="hnd-box" aria-labelledby="hnd-std-l">' + esc(S.standing) + "</div>" +
        (S.stdMsg ? '<div class="hnd-err" role="alert">' + esc(S.stdMsg) + "</div>" : "");
      return S.stdRead ? '<button class="hnd-addstd" data-act="std">+ Standing instructions for every shift</button>' : "";
    }
    return '<h2 class="hnd-lab"><label for="hnd-std">Always</label></h2><form id="hnd-stdf" autocomplete="off">' +
      '<textarea class="hnd-ta" id="hnd-std" aria-describedby="hnd-std-h" placeholder="e.g. Count the CD cupboard every evening"' + (S.stdBusy ? " disabled" : "") + ">" + esc(d.text) + "</textarea>" +
      '<p class="hnd-foot" id="hnd-std-h" style="margin-top:6px">Every shift sees these, every day, until they are changed.</p>' +
      (d.warn ? '<div class="hnd-warn" role="alert">' + esc(d.warn) + "</div>" : "") + (d.err ? '<div class="hnd-err" role="alert">' + esc(d.err) + "</div>" : "") +
      '<div class="hnd-row" style="justify-content:flex-end"><button type="button" class="hnd-btn" data-act="std-cancel">Cancel</button><button type="submit" class="hnd-btn p" title="Save (Ctrl+Enter)"' + (S.stdBusy ? " disabled" : "") + ">" + (S.stdBusy ? "Saving…" : "Save standing instructions") + "</button></div></form>";
  }
  function closeStd() { S.std = null; paint(); var b = S.mount && S.mount.querySelector('[data-act="std"]'); if (b) b.focus(); }
  // The classic screen's save (modules.instructions.js renderEditorCard → saveGlobalToServer): the whole global set,
  // with permanent_handover.text as typed and updated_at the time now. Read afresh first, so a section changed on
  // another till since is kept; standing instructions changed elsewhere since you opened them are never overwritten.
  async function saveStd() {
    var d = S.std; if (!d || S.stdBusy) return;
    var ta = S.mount && S.mount.querySelector("#hnd-std"); if (ta) d.text = ta.value;
    var mine = d.text; d.err = ""; d.warn = ""; S.stdBusy = true; paint();
    try {
      var r0 = await E.apiFetch("/instructions/global", { method: "GET" });
      if (!r0 || !r0.ok) throw new Error((r0 && r0.error) || "the standing instructions could not be read");
      var g = normGlobal(r0.global);
      if (String(g.permanent_handover.text) !== String(d.base || "")) {
        var theirs = String(g.permanent_handover.text); S.standing = theirs; d.base = theirs;
        d.warn = "Someone changed the standing instructions on another till. Theirs are in the box now; yours were: “" + mine + "”. Change them again if still needed.";
        d.text = theirs; S.stdBusy = false; paint(true); var t0 = S.mount && S.mount.querySelector("#hnd-std"); if (t0) E.focusIfIdle(t0, E.lastAction(), null); return;
      }
      g.permanent_handover.text = String(mine);
      g.permanent_handover.updated_at = new Date().toISOString();
      var r = await E.apiFetch("/instructions/global", { method: "PUT", body: JSON.stringify({ global: g }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.standing = mine; S.std = null; S.stdBusy = false; E.toast("Standing instructions saved", "success");
      paint(); var b = S.mount && S.mount.querySelector('[data-act="std"]'); if (b) E.focusIfIdle(b, E.lastAction(), null); // after the reply: not from a field the person went to meanwhile
    } catch (x) { S.stdBusy = false; d.err = E.saveFailText(x); paint(); var t1 = S.mount && S.mount.querySelector("#hnd-std"); if (t1) E.focusIfIdle(t1, E.lastAction(), null); }
  }

  // Read the day as it is now, change one thing, write it back whole.
  async function change(fn, okText, after) {
    if (S.saving) return;
    var ta = S.mount && S.mount.querySelector("#hnd-notes"); if (ta) S.notes = ta.value;
    S.saving = true; S.err = ""; paint();
    try {
      var rec = await day(S.ymd);
      fn(rec);
      if (!rec.notes.trim() && !rec.handover_out.length && (S.mine.notes.trim() || S.mine.handover_out.length > 1)) throw new Error("that would empty the whole day; reload and try again");
      var r = await E.apiFetch("/instructions/daily", { method: "PUT", body: JSON.stringify({ ymd: S.ymd, notes: rec.notes, handover_out: rec.handover_out }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      if (after) after(); E.toast(okText, "success");
      return rec;
    } catch (x) { S.err = E.saveFailText(x); }
    finally { S.saving = false; await load({ quiet: true }); }
  }
  async function saveNotes() {
    var ta = S.mount && S.mount.querySelector("#hnd-notes"); var mine = ta ? ta.value : (S.notes || "");
    S.warn = "";
    var base = S.notesBase, conflict = false;
    var rec = await change(function (fresh) {
      if (fresh.notes !== base) { conflict = fresh.notes; throw new Error("someone changed today's notes since you opened them"); }
      fresh.notes = mine;
    }, "Notes saved");
    if (conflict !== false) { S.warn = "Someone changed today's notes on another till. Theirs are shown now; yours were: “" + mine + "”. Add yours again if still needed."; S.notes = conflict; S.notesBase = conflict; S.err = ""; paint(true); }
    else if (rec) { S.notesBase = mine; S.notes = mine; E.repaintKeepingFocus(S.mount, function () { paint(true); }); } // anything typed while it saved stays, and so does your place
  }

  E.registerModule({
    id: "hndreg", title: "Handover", order: 3, icon: "↻", ui2Only: true,
    render: function (ctx) {
      // Notes typed and not saved, and a point not yet added, are still there when you come back the same day.
      var keepDraft = S.ymd === today();
      S.mount = ctx && ctx.mount; S.ymd = today(); S.mine = null; S.err = ""; S.warn = ""; S.stdBusy = false; S.stdMsg = "";
      if (S.std && S.std.text === S.std.base) S.std = null; // a change typed and not saved is still open on coming back
      if (!keepDraft || !dirty()) S.notes = null;
      if (!keepDraft) S.draft = "";
      css(); paint(); return load();
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("hndreg") < 0) E.UI2_DESTINATIONS.push("hndreg");
  if (E.UI2_PARENT) E.UI2_PARENT.hndreg = "team";
})();
