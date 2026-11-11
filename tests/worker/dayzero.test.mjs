// dayzero (Finish round): a new pharmacy is not blamed for days before it existed, and has its own details for labels
// and prints. Everything here is additive: new fields on existing answers and one new route; no table or column.
import { test, eq, ok } from "./lib.mjs";

const maltaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

test("dayzero: the four day screens say the day the pharmacy started (since), and old rows decide nothing new", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  const today = maltaToday();
  eq((await api("GET", "/auth/me", { token })).json.user.location_since, today, "/auth/me: a pharmacy made today started today");
  for (const p of ["/today", "/registers/today", "/money/today", "/team/today"]) {
    const r = await api("GET", p, { token });
    eq(r.status, 200, p + " " + r.text.slice(0, 200));
    eq(r.json.since, undefined, p + ": the day screens add nothing for it (their read budgets unchanged)");
  }
  const t = await api("GET", "/today", { token });
  eq(t.json.setup.details_saved, false, "Today's first-run list: no address or phone saved yet");
  await api("PUT", "/pharmacy/details", { token, body: { name: "Demo Pharmacy", address: "1 Triq", phone: "", licence: "" } });
  eq((await api("GET", "/today", { token })).json.setup.details_saved, true, "saved: the line goes");
  const team = await api("GET", "/team/today", { token });
  eq(team.json.hours_saved, false, "no opening hours saved yet");
  // A pharmacy made long ago: the stamp's Malta day (UTC 23:30 on 31 Mar is 1 Apr in Malta, summer time).
  DB.db.prepare("INSERT INTO locations (id, org_id, name, created_at) VALUES (7, 1, 'Old Pharmacy', '2024-03-31 23:30:00')").run();
  const old = await addUser({ orgId: 1, locationId: 7, email: "old@example.com", role: "admin", name: "Old Admin" });
  eq(old.user.location_since, "2024-04-01", "Malta day of the creation stamp");
  // A row with no usable stamp: since is "" (nothing clipped, as before).
  DB.db.prepare("INSERT INTO locations (id, org_id, name, created_at) VALUES (8, 1, 'No Stamp', 'garbage')").run();
  const ns = await addUser({ orgId: 1, locationId: 8, email: "ns@example.com", role: "admin", name: "Nos Tamp" });
  eq((await api("GET", "/auth/me", { token: ns.token })).json.user.location_since, "", "no stamp: empty");
});

test("dayzero: since is never later than a saved row (an imported earlier day moves it back)", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  await api("GET", "/money/today", { token }); // makes the end-of-day table (and keeps since = today for this database)
  DB.db.prepare("INSERT INTO orgs (id, name) VALUES (3, 'Fresh Org')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (60, 3, 'Ħamrun Pharmacy')").run();
  DB.db.prepare("INSERT INTO end_of_day (org_id, location_id, eod_date, time_of_day, staff_name) VALUES (3, 60, '2026-09-30', 'PM', 'Joseph Camilleri')").run();
  DB.db.prepare("INSERT INTO temperature_devices (id, org_id, location_id, name) VALUES (90, 3, 60, 'Fridge')").run();
  DB.db.prepare("INSERT INTO temperature_entries (org_id, location_id, device_id, entry_date, min_temp, max_temp) VALUES (3, 60, 90, '2026-09-12', 3, 6)").run();
  const fresh = await addUser({ orgId: 3, locationId: 60, email: "owner@fresh.mt", role: "admin", name: "Joseph Camilleri" });
  eq(fresh.user.location_since, "2026-09-12", "sign-in: the earliest saved day (temperature) beats the creation day");
  eq((await api("GET", "/auth/me", { token: fresh.token })).json.user.location_since, "2026-09-12", "/me says the same");
  const own = await api("GET", "/auth/me", { token });
  eq(own.json.user.location_since, maltaToday(), "a pharmacy made today with nothing saved: today");
  ok(own.json.user.role === "admin" && own.json.user.location_id === 1, "the rest of /me unchanged");
});

test("dayzero: since: a young pharmacy is asked each time (a backfilled day moves it at once); an old one is read once", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  const today = maltaToday();
  const me = async (tk) => (await api("GET", "/auth/me", { token: tk })).json.user.location_since;
  eq(await me(token), today);
  await api("GET", "/money/today", { token }); // the end-of-day table is there
  DB.db.prepare("INSERT INTO end_of_day (org_id, location_id, eod_date, time_of_day, staff_name) VALUES (1, 1, '2026-10-20', 'PM', 'Maria Borg')").run();
  eq(await me(token), "2026-10-20", "a day typed in later with an older date moves the start back at once (no stale cache)");
  // an old pharmacy (its start long before any look-back): read once, then kept
  DB.db.prepare("INSERT INTO locations (id, org_id, name, created_at) VALUES (7, 1, 'Old Pharmacy', '2024-03-31 10:00:00')").run();
  const old = await addUser({ orgId: 1, locationId: 7, email: "old@example.com", role: "admin", name: "Old Admin" });
  let n = 0; const orig = DB.prepare.bind(DB);
  DB.prepare = (sql) => { if (/created_at AS d FROM locations|MIN\((eod_date|entry_date)\) AS d/.test(String(sql))) n++; return orig(sql); };
  for (let i = 0; i < 4; i++) eq(await me(old.token), "2024-03-31");
  DB.prepare = orig;
  eq(n, 0, "an old pharmacy's start is not read again (kept since the sign-in)");
});

test("dayzero: pharmacy details: read, saved by the admin only, kept with the label templates", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap({ location: "Ħamrun Pharmacy" });
  const g0 = await api("GET", "/pharmacy/details", { token });
  eq(g0.status, 200, g0.text);
  eq(g0.json.details, { name: "", address: "", phone: "", licence: "" });
  eq(g0.json.saved, false); eq(g0.json.location_name, "Ħamrun Pharmacy"); eq(g0.json.since, maltaToday());
  // The classic labels screen saved templates and an older pharmacyDetails with an extra key: both must survive.
  const st = { labelHistory: [{ id: "L1", drugName: "Amoxil" }], templates: [{ id: "tpl_x", name: "Mine", fields: ["drugName"] }], pharmacyDetails: { name: "Old", address: "", phone: "", licence: "", logo: "keep-me" } };
  eq((await api("PUT", "/labels/state", { token, body: { state: st } })).status, 200);
  const body = { name: "Ħamrun Pharmacy", address: "12, Triq il-Kbira San Ġużepp, Ħamrun HMR 1011", phone: "2123 4567", licence: "PH 123" };
  const p = await api("PUT", "/pharmacy/details", { token, body });
  eq(p.status, 200, p.text);
  eq(p.json.details, body);
  const row = JSON.parse(DB.db.prepare("SELECT settings_json FROM label_settings WHERE org_id = 1 AND location_id = 1").get().settings_json);
  eq(row.templates, st.templates, "templates unchanged");
  eq(row.pharmacyDetails.logo, "keep-me", "other keys kept");
  eq(row.pharmacyDetails.address, body.address);
  const lab = await api("GET", "/labels/state", { token });
  eq(lab.json.state.pharmacyDetails.address, body.address, "the label screens read the same address");
  eq(lab.json.state.labelHistory.length, 1, "label history untouched");
  // Validation and rights
  eq((await api("PUT", "/pharmacy/details", { token, body: { name: "  ", address: "x" } })).status, 400, "name needed");
  eq((await api("PUT", "/pharmacy/details", { token, body: { name: "A", address: "x".repeat(301) } })).status, 400, "too long");
  const staff = await addUser({ orgId: 1, locationId: 1, email: "staff@example.com", role: "staff", name: "Rita Grech" });
  eq((await api("GET", "/pharmacy/details", { token: staff.token })).json.details.phone, "2123 4567", "staff can read");
  eq((await api("PUT", "/pharmacy/details", { token: staff.token, body })).status, 403, "staff cannot change");
  // Another pharmacy never sees them
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  const br = await addUser({ orgId: 1, locationId: 2, email: "br@example.com", role: "admin", name: "Branch Admin" });
  eq((await api("GET", "/pharmacy/details", { token: br.token })).json.details.address, "", "isolated per pharmacy");
  // An audit line with before and after
  const a = DB.db.prepare("SELECT details_json FROM audit_log WHERE action = 'PHARMACY_DETAILS_PUT'").all();
  eq(a.length, 1); ok(/Triq il-Kbira/.test(a[0].details_json));
});

test("dayzero: a first details save with no label row makes the row the labels screen would", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  eq((await api("PUT", "/pharmacy/details", { token, body: { name: "Demo Pharmacy", address: "1 Triq", phone: "", licence: "" } })).status, 200);
  const row = JSON.parse(DB.db.prepare("SELECT settings_json FROM label_settings").get().settings_json);
  eq(row, { templates: [], pharmacyDetails: { name: "Demo Pharmacy", address: "1 Triq", phone: "", licence: "" } });
});

