// Shared by the correct-*.mjs cases: correcting a register line in the new layout (ui/eikon.correct.js).
// For one screen: two identical lines are recorded (o.create, through the API). Line A is corrected on the new screen:
// without a reason nothing is sent; with one, the stored row differs from before ONLY in the corrected columns and the
// clock/who columns, and the update's audit entry carries the reason with the row before and after. Twin line B gets
// the same change as the classic screen sends it (its edit body, through the API): the two stored rows must be equal
// in every column. Then: the line shows "Corrected … by …: reason"; a line changed by someone else while the form was
// open is refused and both versions are shown; a staff sign-in sees no Correct button.
import { ymd } from "../lib.mjs";

const CLOCK = ["id", "created_at", "updated_at", "updated_by"];

export async function correctCase(t, o) {
  const app = t.stack.app;
  const call = async (method, path, body, token = t.token) => { const r = await app.api(method, path, { token, headers: o.headers, body }); if (r.status >= 400) t.fail(`${o.label}: ${method} ${path} answered ${r.status}: ${r.text.slice(0, 160)}`); return r.json; };
  if (o.setup) await o.setup(call);
  const made = async (i) => { const m = t.maxId(o.table); await call("POST", o.path, typeof o.create === "function" ? o.create(i) : o.create); const r = t.since(o.table, m)[0]; t.ok(r, o.label + ": the seed line was not stored"); return r; };
  const A = await made(0), B = await made(1);
  const upd = (row) => o.putPath ? o.putPath(row) : o.path + "/" + row.id;
  const reason = "Typed wrong (" + o.label + ")";

  const p = await t.page();
  // o.reveal(page, row): a screen whose Correct is inside something opened first (Temperature: the day)
  await t.open(p, "2", o.hash, o.newId, o.reveal ? o.ready : `[data-ecr=open][data-ecr-id="${A.id}"]`);
  if (o.reveal) await o.reveal(p, A);
  await p.click(`[data-ecr=open][data-ecr-id="${A.id}"]`);
  await p.waitForSelector("[data-ecr-form] [name=ecr__reason]");
  const F = "[data-ecr-form] ";
  // the form is filled with the line as the server holds it
  for (const [k, f] of Object.entries(o.shown || {})) t.ok(await p.inputValue(F + `[name=ecr_${k}]`) === String(f), `${o.label}: the form shows ${k} as ${f}`);
  const setAll = async (edit = o.edit) => {
    for (const [k, v] of Object.entries(edit)) {
      const el = p.locator(F + `[name=ecr_${k}]`);
      if (await el.getAttribute("type") === "checkbox") await el.setChecked(!!v);
      else if ((await el.evaluate((e) => e.tagName)) === "SELECT") await el.selectOption(String(v));
      else await el.fill(String(v));
    }
    if (o.pass) await p.fill(F + "[name=ecr__pass]", o.pass);
  };
  await setAll();
  let puts = 0; const onReq = (r) => { if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith(o.path)) puts++; };
  p.on("request", onReq);
  await p.click(F + "button[type=submit]"); await p.waitForTimeout(500);
  t.ok(puts === 0, o.label + ": a correction without a reason was sent");
  t.ok(/what was wrong/i.test(await p.textContent(F + ".ecr-err").catch(() => "")), o.label + ": no 'write what was wrong' message without a reason");
  p.off("request", onReq);
  await p.fill(F + "[name=ecr__reason]", reason);
  const w = await t.write(p, new RegExp(upd(A).replace(/[/]/g, "\\/") + "$"), () => p.click(F + "button[type=submit]"), o.method || "PUT");
  t.ok(w.body && w.body.correction_reason === reason || (w.body && w.body.record && w.body.record.correction_reason === reason), o.label + ": the reason went with the update");
  if (o.bodyKeys) t.ok(JSON.stringify(Object.keys(w.body).filter((k) => k !== "correction_reason").sort()) === JSON.stringify(o.bodyKeys.slice().sort()), `${o.label}: the body has the classic's fields (${Object.keys(w.body).sort().join(",")})`);
  const A2 = t.row(o.table, A.id);
  const edited = Object.keys(o.want);
  for (const k of Object.keys(A)) {
    if (CLOCK.includes(k)) continue;
    if (edited.includes(k)) t.ok(JSON.stringify(A2[k]) === JSON.stringify(o.want[k]), `${o.label}: corrected column ${k} should be ${JSON.stringify(o.want[k])}, stored ${JSON.stringify(A2[k])}`);
    else t.ok(JSON.stringify(A2[k]) === JSON.stringify(A[k]), `${o.label}: column ${k} changed although it was not corrected: ${JSON.stringify(A[k])} → ${JSON.stringify(A2[k])}`);
  }
  const au = t.db.prepare("SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? AND action = ? ORDER BY id DESC").get(o.table, String(A.id), o.action);
  const d = au ? JSON.parse(au.details_json || "{}") : {};
  t.ok(d.correction_reason === reason, `${o.label}: the audit entry has the reason (${JSON.stringify(d.correction_reason)})`);
  t.ok(d.before && Object.keys(A).every((k) => JSON.stringify(d.before[k]) === JSON.stringify(A[k])), o.label + ": the audit keeps the whole line as it was");
  t.ok(d.after && edited.every((k) => JSON.stringify(d.after[k]) === JSON.stringify(o.want[k])), o.label + ": the audit keeps the line as corrected");

  // the twin, changed as the classic screen sends it
  await call(o.method || "PUT", upd(B), o.classic(B));
  const B2 = t.row(o.table, B.id);
  t.same(o.label + " new vs classic", B2, A2, o.allow || {});

  // the line says it was corrected, by whom, and why
  await p.waitForFunction((r) => [...document.querySelectorAll(".ecr-mark")].some((e) => e.textContent.includes(r)), reason, { timeout: 8000 }).catch(() => {});
  const mark = await p.evaluate((r) => ([...document.querySelectorAll(".ecr-mark")].find((e) => e.textContent.includes(r)) || {}).textContent || "", reason);
  t.ok(/Corrected .* by Maria Borg: /.test(mark), `${o.label}: the line shows who corrected it and why (${mark})`);

  // someone else changes line B while it is open here: nothing is saved, both versions are shown
  if (o.stale) {
    if (o.reveal) await o.reveal(p, B);
    await p.click(`[data-ecr=open][data-ecr-id="${B.id}"]`);
    await p.waitForSelector("[data-ecr-form] [name=ecr__reason]");
    await setAll(o.edit2);
    await p.fill(F + "[name=ecr__reason]", "stale test");
    await call(o.method || "PUT", upd(B), o.stale(B2));
    const B3 = t.row(o.table, B.id);
    let sent = 0; const onR = (r) => { if (r.method() === (o.method || "PUT") && new URL(r.url()).pathname.startsWith(o.path)) sent++; }; p.on("request", onR);
    await p.click(F + "button[type=submit]");
    await p.waitForSelector(".ecr-stale", { timeout: 8000 }).catch(async () => { t.note("stale form: " + (await p.textContent("[data-ecr-form]").catch(() => "(no form)"))); });
    p.off("request", onR);
    t.ok(sent === 0, o.label + ": a line changed elsewhere was overwritten");
    t.ok(/Someone else changed this line/.test(await p.textContent(".ecr-stale").catch(() => "")), o.label + ": both versions not shown for a line changed elsewhere");
    t.ok(JSON.stringify(t.row(o.table, B.id)) === JSON.stringify(B3), o.label + ": the line changed elsewhere was touched");
    await p.click(F + "[data-ecr=cancel]");
  }

  // staff: no Correct
  if (!t.stack.staff) { const s = await app.addUser({ email: "staff-" + Date.now() + "@demo.mt", role: "staff", name: "Sam Staff" }).catch(() => null); t.stack.staff = s; }
  if (t.stack.staff) {
    const q = await t.page();
    await q.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, t.stack.staff.token);
    await t.open(q, "2", o.hash, o.newId, o.ready);
    await q.waitForTimeout(400);
    t.ok(await q.locator("[data-ecr=open]").count() === 0, o.label + ": a staff sign-in sees Correct");
    t.ok(/corrected by the pharmacist/.test(await q.textContent(o.footSel || ".ecr-foot").catch(() => "")), o.label + ": the staff footer says who corrects");
  }
}
export { ymd };
