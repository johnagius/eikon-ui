// Shared by the sflow-* cases (Stock flows, round 2): a delete closed out of the classic screen. Two twin rows; the
// classic screen deletes one, the new screen the other. The two requests must be the same (method, path shape, body),
// the answers the same, both rows gone, and the audit entries the same (ids and clock stamps set aside).
const STAMP = ["id", "created_at", "updated_at", "entity_id"];
export const strip = (v) => Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => !STAMP.includes(k)).map((k) => [k, strip(v[k])])) : v;
const n = (r) => JSON.stringify({ action: r.action, entity_type: r.entity_type, user_id: r.user_id, location_id: r.location_id, org_id: r.org_id, details: strip(JSON.parse(r.details_json || "null")) });
export const audit = (t, entity, id, since) => t.db.prepare("SELECT * FROM audit_log WHERE id > ? AND entity_type = ? AND entity_id = ? ORDER BY id").all(since, entity, String(id));
// Every write the page sends while `fn` runs (method, path, body).
export async function writes(p, re, fn) {
  const out = []; const on = (r) => { const u = new URL(r.url()); if (re.test(u.pathname) && r.method() !== "GET") out.push({ m: r.method(), path: u.pathname, body: r.postData() }); };
  p.on("request", on); try { await fn(); } finally { p.off("request", on); }
  return out;
}
// cfg: { label, table, entity (audit entity_type), action (audit action), path: (id) => RegExp, a, b (twin ids),
//        classic: async (p, id) => {...}, fresh: async (p, id) => {...}, also: (t, a, b) => extra checks after both,
//        pick: true when the classic deletes whichever twin it shows first (cfg.path must then match both),
//        norm: (auditJson) => the audit text with what differs by design between the twins set aside }
export async function twinDelete(t, p, cfg) {
  const L = cfg.label, au = t.maxId("audit_log");
  const before = { a: t.row(cfg.table, cfg.a), b: t.row(cfg.table, cfg.b) };
  if (!t.ok(before.a && before.b, L + ": the two twins exist")) return false;
  let cw, nw;
  const cReq = await writes(p, /./, async () => { cw = await t.write(p, cfg.path(cfg.a), () => cfg.classic(p, cfg.a), "DELETE"); await t.idle(p); });
  // pick: the classic screen cannot be pointed at one twin (its rows carry no id): it deletes one, the new screen the other
  if (cfg.pick && t.row(cfg.table, cfg.a) && !t.row(cfg.table, cfg.b)) cfg = { ...cfg, a: cfg.b, b: cfg.a };
  t.ok(!t.row(cfg.table, cfg.a), L + ": the classic screen deleted its twin");
  const nReq = await writes(p, /./, async () => { nw = await t.write(p, cfg.path(cfg.b), () => cfg.fresh(p, cfg.b), "DELETE"); await t.idle(p); });
  const shape = (r) => r.filter((x) => x.m === "DELETE").map((x) => x.m + " " + x.path.replace(/\d+/g, "#") + " " + (x.body == null ? "" : x.body));
  t.ok(JSON.stringify(shape(cReq)) === JSON.stringify(shape(nReq)) && shape(nReq).length === 1, L + ": the same DELETE, no body: classic " + JSON.stringify(shape(cReq)) + " new " + JSON.stringify(shape(nReq)));
  t.ok(nReq.filter((x) => x.m !== "DELETE").length === 0, L + ": the new screen sends nothing else: " + JSON.stringify(nReq.filter((x) => x.m !== "DELETE")));
  t.ok(cw.status === 200 && nw.status === 200 && JSON.stringify(cw.json) === JSON.stringify(nw.json), L + ": the same answer: classic " + JSON.stringify(cw.json) + " new " + JSON.stringify(nw.json));
  t.ok(!t.row(cfg.table, cfg.a) && !t.row(cfg.table, cfg.b), L + ": both rows gone");
  const A = audit(t, cfg.entity, cfg.a, au), B = audit(t, cfg.entity, cfg.b, au);
  if (t.ok(A.length >= 1 && A.length === B.length, `${L}: the same number of audit entries (classic ${A.length}, new ${B.length})`)) {
    const nn = (r) => cfg.norm ? cfg.norm(n(r)) : n(r);
    t.ok(JSON.stringify(A.map(nn)) === JSON.stringify(B.map(nn)), `${L}: audit entries differ:\n classic ${A.map(n).join("|").slice(0, 400)}\n new     ${B.map(n).join("|").slice(0, 400)}`);
    if (cfg.action) t.ok(B.some((x) => x.action === cfg.action), L + ": the audit says " + cfg.action + ": " + B.map((x) => x.action).join());
  }
  if (cfg.also) await cfg.also(t, cfg.a, cfg.b);
  return true;
}
// A staff page (the server lets staff delete; the rebuilt screens keep it to the pharmacist).
export async function staffPage(t) {
  if (!t.stack.staff) t.stack.staff = await t.stack.app.addUser({ email: "staff-sflow@demo.mt", role: "staff", name: "Sam Staff" }).catch(() => null);
  if (!t.stack.staff) return null;
  const s = await t.page(); await s.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, t.stack.staff.token);
  return s;
}
