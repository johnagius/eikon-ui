import { test, eq, ok } from "./lib.mjs";

// A Monday well in the future, so "not in the past" never interferes.
const MON = "2027-03-01";
const wd = (ymd) => new Date(ymd + "T00:00:00Z").getUTCDay();

async function setup(api, token, { dur = 15, buf = 0, hours } = {}) {
  eq(wd(MON), 1, "MON is a Monday");
  const p = await api("POST", "/bookings/providers", { token, body: { name: "Maria", kind: "pharmacist", hours: hours || { 1: [["09:00", "10:00"]] } } });
  eq(p.status, 201, p.text);
  const s = await api("POST", "/bookings/services", { token, body: { name: "Flu vaccine", durationMin: dur, bufferMin: buf, priceCents: 1500, providerIds: [p.json.provider.id] } });
  eq(s.status, 201, s.text);
  return { pid: p.json.provider.id, sid: s.json.service.id };
}
const slots = async (api, token, sid, date = MON) => (await api("GET", `/bookings/slots?service_id=${sid}&date=${date}`, { token })).json.slots.map((x) => x.time);
const book = (api, token, sid, start, extra = {}) => api("POST", "/bookings", { token, body: { serviceId: sid, date: MON, start, personName: "Carmen Grech", personPhone: "79123456", ...extra } });

test("bookings: free slots come from weekly hours, in steps of the service length", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const { sid } = await setup(api, token);
  eq(await slots(api, token, sid), ["09:00", "09:15", "09:30", "09:45"]);
  eq(await slots(api, token, sid, "2027-03-02"), [], "no hours on Tuesday");
});

test("bookings: a booking and its buffer remove the overlapping slots; cancelling frees them", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const { sid } = await setup(api, token, { dur: 15, buf: 5 });
  eq(await slots(api, token, sid), ["09:00", "09:20", "09:40"]);
  const b = await book(api, token, sid, "09:20");
  eq(b.status, 201, b.text);
  eq(b.json.booking.end, "09:35"); eq(b.json.booking.priceCents, 1500, "price defaults from the service");
  ok(b.json.booking.ref.startsWith("B-"));
  eq(await slots(api, token, sid), ["09:00", "09:40"]);
  const c = await api("PATCH", "/bookings/" + b.json.booking.id, { token, body: { version: 1, status: "cancelled", cancelReason: "Called to cancel" } });
  eq(c.status, 200, c.text);
  eq(await slots(api, token, sid), ["09:00", "09:20", "09:40"]);
});

test("bookings: cancelling needs a reason; unknown status refused", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const { sid } = await setup(api, token);
  const b = await book(api, token, sid, "09:00");
  eq((await api("PATCH", "/bookings/" + b.json.booking.id, { token, body: { version: 1, status: "cancelled" } })).status, 400);
  eq((await api("PATCH", "/bookings/" + b.json.booking.id, { token, body: { version: 1, status: "gone" } })).status, 400);
});

test("bookings: a taken or invalid time is refused with the next free times", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const { sid } = await setup(api, token);
  eq((await book(api, token, sid, "09:00")).status, 201);
  const again = await book(api, token, sid, "09:00", { personName: "Joseph Vella" });
  eq(again.status, 409, again.text);
  eq(again.json.next.map((s) => s.time), ["09:15", "09:30", "09:45"]);
  eq((await book(api, token, sid, "09:07")).status, 409, "not on the grid");
  eq((await book(api, token, sid, "11:00")).status, 409, "outside hours");
});

test("bookings: two counters booking the same slot at once get one booking, not two", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const { sid } = await setup(api, token);
  const res = await Promise.all([book(api, token, sid, "09:30", { personName: "A" }), book(api, token, sid, "09:30", { personName: "B" }), book(api, token, sid, "09:30", { personName: "C" })]);
  eq(res.filter((r) => r.status === 201).length, 1, res.map((r) => r.status).join(","));
  eq(DB.q("SELECT COUNT(*) AS c FROM bk_bookings WHERE start_time='09:30' AND status<>'cancelled'")[0].c, 1);
  // The database itself refuses a duplicate active slot.
  let threw = false;
  try { DB.db.prepare("INSERT INTO bk_bookings (org_id, location_id, service_id, provider_id, person_name, date, start_time, end_time) SELECT org_id, location_id, service_id, provider_id, 'X', date, start_time, end_time FROM bk_bookings LIMIT 1").run(); } catch (e) { threw = /UNIQUE/i.test(e.message); }
  ok(threw, "partial unique index guards double booking");
});

test("bookings: days off and part-days off remove slots; an extra evening adds them", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const { sid, pid } = await setup(api, token);
  eq((await api("POST", "/bookings/exceptions", { token, body: { providerId: pid, date: MON, kind: "off", start: "09:15", end: "09:45" } })).status, 201);
  eq(await slots(api, token, sid), ["09:00", "09:45"]);
  eq((await api("POST", "/bookings/exceptions", { token, body: { providerId: pid, date: "2027-03-02", kind: "extra", start: "18:00", end: "18:30" } })).status, 201);
  eq(await slots(api, token, sid, "2027-03-02"), ["18:00", "18:15"]);
  eq((await api("POST", "/bookings/exceptions", { token, body: { providerId: pid, date: MON, kind: "off" } })).status, 201);
  eq(await slots(api, token, sid), [], "whole day off");
});

test("bookings: moving is atomic, keeps the booking, frees the old time, and can shift into its own overlap", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const { sid } = await setup(api, token);
  const b = (await book(api, token, sid, "09:00")).json.booking;
  eq((await book(api, token, sid, "09:30", { personName: "Other" })).status, 201);
  const blocked = await api("PATCH", "/bookings/" + b.id, { token, body: { version: 1, start: "09:30" } });
  eq(blocked.status, 409, "cannot move onto someone else");
  const mv = await api("PATCH", "/bookings/" + b.id, { token, body: { version: 1, start: "09:15" } });
  eq(mv.status, 200, mv.text);
  eq([mv.json.booking.id, mv.json.booking.start, mv.json.booking.end, mv.json.booking.version], [b.id, "09:15", "09:30", 2]);
  eq(await slots(api, token, sid), ["09:00", "09:45"]);
  eq(DB.q("SELECT COUNT(*) AS c FROM bk_bookings")[0].c, 2, "no extra rows from a move");
});

test("bookings: a stale edit is refused with the current version", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const { sid } = await setup(api, token);
  const b = (await book(api, token, sid, "09:00")).json.booking;
  eq((await api("PATCH", "/bookings/" + b.id, { token, body: { version: 1, status: "arrived" } })).status, 200);
  const stale = await api("PATCH", "/bookings/" + b.id, { token, body: { version: 1, notes: "late" } });
  eq(stale.status, 409); eq(stale.json.current.status, "arrived");
});

test("bookings: lists one date range only and stays inside the pharmacy", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  const { sid } = await setup(api, token);
  await book(api, token, sid, "09:00");
  eq((await api("GET", `/bookings?from=${MON}&to=${MON}`, { token })).json.bookings.length, 1);
  eq((await api("GET", `/bookings`, { token })).status, 400, "a range is required");
  eq((await api("GET", `/bookings?from=2027-01-01&to=2027-06-01`, { token })).status, 400, "range is capped");
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Sister')").run();
  const other = await addUser({ locationId: 2, email: "sister@example.com" });
  eq((await api("GET", `/bookings?from=${MON}&to=${MON}`, { token: other.token })).json.bookings.length, 0);
  eq((await api("GET", `/bookings/slots?service_id=${sid}&date=${MON}`, { token: other.token })).status, 404, "services are per pharmacy");
  eq((await api("PATCH", "/bookings/1", { token: other.token, body: { version: 1, status: "done" } })).status, 404);
});

test("bookings: only an admin changes services and hours; staff can book", async ({ api, bootstrap, addUser }) => {
  const { token } = await bootstrap();
  const { sid } = await setup(api, token);
  const staff = await addUser({ email: "staff@example.com", role: "staff" });
  eq((await api("POST", "/bookings/services", { token: staff.token, body: { name: "X", durationMin: 10 } })).status, 403);
  eq((await book(api, staff.token, sid, "09:00")).status, 201);
});

test("bookings: next free times start from today and skip what is taken", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const all = { 0: [["09:00", "09:30"]], 1: [["09:00", "09:30"]], 2: [["09:00", "09:30"]], 3: [["09:00", "09:30"]], 4: [["09:00", "09:30"]], 5: [["09:00", "09:30"]], 6: [["09:00", "09:30"]] };
  const { sid } = await setup(api, token, { hours: all });
  const n = await api("GET", `/bookings/next?service_id=${sid}&count=4`, { token });
  eq(n.status, 200, n.text);
  eq(n.json.slots.length, 4);
  ok(n.json.slots[0].date >= n.json.serverNow.date, "never in the past");
});

test("bookings: waiting list — a cancellation offers the freed time to the first person waiting; booking marks them done", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  const { sid } = await setup(api, token);
  const b = (await book(api, token, sid, "09:00")).json.booking;
  eq((await api("POST", "/bookings/waitlist", { token, body: { serviceId: sid, personName: "Rita Camilleri", personPhone: "79111111" } })).status, 201);
  eq((await api("POST", "/bookings/waitlist", { token, body: { serviceId: sid, personName: "Second Person" } })).status, 201);
  eq((await api("POST", "/bookings/waitlist", { token, body: { serviceId: sid, personName: "" } })).status, 400);
  const c = await api("PATCH", "/bookings/" + b.id, { token, body: { version: 1, status: "cancelled", cancelReason: "Ill" } });
  eq(c.status, 200);
  eq([c.json.offer.personName, c.json.offer.start, c.json.offer.date], ["Rita Camilleri", "09:00", MON], "first come, first served");
  const nb = await api("POST", "/bookings", { token, body: { serviceId: sid, date: MON, start: "09:00", personName: c.json.offer.personName, personPhone: c.json.offer.personPhone, waitlistId: c.json.offer.waitlistId } });
  eq(nb.status, 201, nb.text);
  const w = await api("GET", "/bookings/waitlist", { token });
  eq(w.json.waiting.map((x) => x.personName), ["Second Person"], "Rita leaves the list once booked");
  eq(DB.q("SELECT status, booking_id FROM bk_waitlist WHERE person_name='Rita Camilleri'")[0].booking_id, nb.json.booking.id);
  // Removing, and staying inside the pharmacy
  const second = w.json.waiting[0].id;
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Sister')").run();
  const other = await addUser({ locationId: 2, email: "sister@example.com" });
  eq((await api("PATCH", "/bookings/waitlist/" + second, { token: other.token, body: { status: "removed" } })).status, 404);
  eq((await api("PATCH", "/bookings/waitlist/" + second, { token, body: { status: "removed" } })).status, 200);
  eq((await api("GET", "/bookings/waitlist", { token })).json.waiting.length, 0);
});
