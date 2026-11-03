/* Handover, new layout: what yesterday's team left for today (most critical first), the standing instructions, today's
   notes, and what today leaves for tomorrow (add a point, mark it Low / Medium / Critical, remove one).
   The day's record is replaced whole on every save and deleted if left empty (UPDATE-AUDIT.md), so every save first
   reads the day afresh and changes only the one thing asked: a point added or removed by someone else on another
   till is kept. Notes edited elsewhere since you opened them are never overwritten: theirs are shown instead.
   Editing the standing instructions and other days stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, ymd: "", incoming: [], mine: null, standing: "", loading: false, error: "", sev: "g", draft: "", notes: null, notesBase: "", saving: false, err: "", warn: "" };
  var SEV = { r: ["Critical", 0], y: ["Medium", 1], g: ["Low", 2] };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return ymdOf(new Date()); }
  function yesterday() { var d = new Date(); d.setDate(d.getDate() - 1); return ymdOf(d); }
  function bySev(a, b) { return (SEV[a.sev] || SEV.g)[1] - (SEV[b.sev] || SEV.g)[1]; }
  function clean(rec) { return { notes: String((rec && rec.notes) || ""), handover_out: Array.isArray(rec && rec.handover_out) ? rec.handover_out : [] }; }

  function css() {
    if (document.getElementById("eikon-hndreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-hndreg-css";
    st.textContent =
      ".hnd{max-width:880px;margin:0 auto}" +
      ".hnd-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".hnd h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.hnd-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".hnd-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".hnd-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.hnd-btn:disabled{opacity:.55;cursor:default}.hnd-btn.x{border:0;background:none;color:var(--muted);height:28px;padding:0 6px}" +
      ".hnd-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:22px 2px 7px;display:flex;gap:8px}.hnd-lab b{color:var(--text)}" +
      ".hnd-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".hnd-pt{display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-top:.5px solid var(--border);font-size:15px;line-height:1.35}.hnd-pt:first-child{border-top:0}.hnd-pt .t{flex:1;min-width:0;white-space:pre-wrap}" +
      ".hnd-dot{flex:0 0 9px;height:9px;border-radius:50%;margin-top:6px;background:var(--ok)}.hnd-dot.y{background:#E0A100}.hnd-dot.r{background:var(--danger)}" +
      ".hnd-pt small{display:block;font-size:11.5px;color:var(--muted);font-weight:600;letter-spacing:.02em}.hnd-pt.r small{color:var(--danger)}" +
      ".hnd-box{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:15px;white-space:pre-wrap;line-height:1.4}" +
      ".hnd-ta{width:100%;box-sizing:border-box;min-height:96px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:12px 14px;outline:0;resize:vertical}" +
      ".hnd-row{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}.hnd-in{flex:1;min-width:180px;height:40px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0}" +
      ".hnd-seg{display:flex;gap:4px}.hnd-seg button{font:inherit;font-size:13px;font-weight:600;height:32px;padding:0 10px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer}" +
      ".hnd-seg button.on{color:#fff}.hnd-seg button.on[data-sev=g]{background:var(--ok);border-color:var(--ok)}.hnd-seg button.on[data-sev=y]{background:#C98A12;border-color:#C98A12}.hnd-seg button.on[data-sev=r]{background:var(--danger);border-color:var(--danger)}" +
      ".hnd-err{color:var(--danger);font-size:13px;margin-top:6px}.hnd-warn{font-size:13.5px;margin-top:8px;padding:10px 12px;border-radius:10px;background:rgba(201,138,18,.12)}" +
      ".hnd-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:12px;padding:16px;color:var(--muted)}" +
      "@media (max-width:600px){.hnd{padding:4px 16px 0}.hnd h1{font-size:32px}}";
    document.head.appendChild(st);
  }

  async function day(ymd) {
    var r = await E.apiFetch("/instructions/daily?ymd=" + encodeURIComponent(ymd), { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the handover");
    return clean(r.record);
  }
  async function load() {
    S.loading = true; S.error = ""; paint();
    try {
      var res = await Promise.all([day(yesterday()), day(S.ymd), E.apiFetch("/instructions/global", { method: "GET" }).catch(function () { return null; })]);
      S.incoming = res[0].handover_out.slice().sort(bySev);
      S.mine = res[1];
      if (S.notes == null) { S.notes = S.mine.notes; S.notesBase = S.mine.notes; }
      var g = res[2] && res[2].ok && res[2].global; S.standing = g && g.permanent_handover && g.permanent_handover.text ? String(g.permanent_handover.text) : "";
    } catch (e) { S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the handover"); }
    S.loading = false; paint();
  }

  function pt(b, removable) {
    var sev = SEV[b.sev] ? b.sev : "g";
    return '<div class="hnd-pt ' + sev + '"><span class="hnd-dot ' + sev + '"></span><div class="t">' + (sev !== "g" ? "<small>" + SEV[sev][0].toUpperCase() + "</small>" : "") + esc(b.text) + "</div>" +
      (removable ? '<button class="hnd-btn x" data-act="rm" data-id="' + esc(b.id) + '" aria-label="Remove">Remove</button>' : "") + "</div>";
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "hndreg") return; // left before a reply came back: do not draw over the next screen
    var ta = m.querySelector("#hnd-notes"); if (ta && !fromState) S.notes = ta.value; // typing survives every repaint
    var inp = m.querySelector("#hnd-new"); if (inp) S.draft = inp.value;
    var h = '<div class="hnd"><button class="hnd-back" data-act="back">‹ Team</button><h1>Handover</h1><p class="hnd-sub">What the last shift left you, and what you leave the next one.</p>';
    if (S.error) h += '<div class="hnd-quiet" style="margin-top:16px">' + esc(S.error) + "</div>";
    else if (!S.mine) h += '<div class="hnd-quiet" style="margin-top:16px">Opening the handover…</div>';
    else {
      h += '<div class="hnd-lab">From yesterday <b>' + S.incoming.length + "</b></div>" + (S.incoming.length ? '<div class="hnd-list">' + S.incoming.map(function (b) { return pt(b, false); }).join("") + "</div>" : '<div class="hnd-quiet">Nothing was handed over from yesterday.</div>');
      if (S.standing) h += '<div class="hnd-lab">Always</div><div class="hnd-box">' + esc(S.standing) + "</div>";
      h += '<div class="hnd-lab">Today\'s notes</div><textarea class="hnd-ta" id="hnd-notes" placeholder="Anything for today\'s team">' + esc(S.notes || "") + "</textarea>" +
        (S.warn ? '<div class="hnd-warn">' + esc(S.warn) + "</div>" : "") +
        '<div class="hnd-row" style="justify-content:flex-end"><button class="hnd-btn p" data-act="notes"' + (S.saving || (S.notes || "") === S.notesBase ? " disabled" : "") + ">Save notes</button></div>";
      var out = S.mine.handover_out.slice().sort(bySev);
      h += '<div class="hnd-lab">For tomorrow <b>' + out.length + "</b></div>" + (out.length ? '<div class="hnd-list">' + out.map(function (b) { return pt(b, true); }).join("") + "</div>" : "") +
        '<form class="hnd-row" id="hnd-add" autocomplete="off"><input class="hnd-in" id="hnd-new" placeholder="e.g. Call Mrs Borg about her insulin" value="' + esc(S.draft) + '">' +
        '<div class="hnd-seg">' + ["g", "y", "r"].map(function (k) { return '<button type="button" data-sev="' + k + '" class="' + (S.sev === k ? "on" : "") + '">' + SEV[k][0] + "</button>"; }).join("") + "</div>" +
        '<button type="submit" class="hnd-btn p"' + (S.saving ? " disabled" : "") + ">Add</button></form>" +
        (S.err ? '<div class="hnd-err">' + esc(S.err) + "</div>" : "");
    }
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:14px">Changing the standing instructions, fees and other days are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    m.innerHTML = h;
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = "#team";
        else if (act === "notes") saveNotes();
        else if (act === "rm") change(function (rec) { var id = b.getAttribute("data-id"); rec.handover_out = rec.handover_out.filter(function (x) { return String(x.id) !== id; }); }, "Removed");
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "hndreg"); } catch (x) {} E.openClassic("instructions"); }
      });
    });
    m.querySelectorAll(".hnd-seg [data-sev]").forEach(function (b) { b.addEventListener("click", function () { S.sev = b.getAttribute("data-sev"); paint(); }); });
    var t = m.querySelector("#hnd-notes"); if (t) t.addEventListener("input", function () { var btn = m.querySelector('[data-act="notes"]'); if (btn) btn.disabled = S.saving || t.value === S.notesBase; });
    var f = m.querySelector("#hnd-add"); if (f) f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var text = String((m.querySelector("#hnd-new") || {}).value || "").trim(); S.draft = text;
      if (!text) { S.err = "Write the point for tomorrow. Nothing was saved."; return paint(); }
      var sev = S.sev;
      change(function (rec) { rec.handover_out = rec.handover_out.concat([{ id: "b_" + Date.now() + "_" + String(Math.random()).slice(2), sev: sev, text: text, created_at: new Date().toISOString() }]); }, "Added for tomorrow", function () { S.draft = ""; var i = S.mount && S.mount.querySelector("#hnd-new"); if (i) i.value = ""; });
    });
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
    finally { S.saving = false; await load(); }
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
    else if (rec) { S.notesBase = mine; S.notes = mine; paint(true); }
  }

  E.registerModule({
    id: "hndreg", title: "Handover", order: 3, icon: "↻", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.ymd = today(); S.mine = null; S.notes = null; S.err = ""; S.warn = ""; S.draft = ""; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("hndreg") < 0) E.UI2_DESTINATIONS.push("hndreg");
  if (E.UI2_PARENT) E.UI2_PARENT.hndreg = "team";
})();
