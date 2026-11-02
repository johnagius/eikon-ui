import { test, eq, ok } from "./lib.mjs";

async function setup(api, token) {
  const d = await api("POST", "/appointments/doctors", { token, body: { name: "Dr Galea", specialty: "GP" } });
  eq(d.status < 300, true, d.text);
  const c = await api("POST", "/appointments/clinics", { token, body: { name: "Main clinic", locality: "Valletta" } });
  eq(c.status < 300, true, c.text);
  const id = (r) => r.json.id || (r.json.doctor && r.json.doctor.id) || (r.json.clinic && r.json.clinic.id);
  return { doctorId: id(d), clinicId: id(c) };
}
const book = (api, token, ids, extra = {}) => api("POST", "/appointments/entries", { token, body: { patient_name: "Carmel Zammit", patient_id_card: "12345M", doctor_id: ids.doctorId, clinic_id: ids.clinicId, date: "2026-11-20", time: "09:00", duration_mins: 15, notes: "Staff only: owes €10", ...extra } });

test("appointments: a cancelled booking frees its slot (stored as 'Cancelled')", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const ids = await setup(api, token);
  const a = await book(api, token, ids);
  eq(a.status, 201, a.text);
  eq((await book(api, token, ids, { patient_name: "Someone Else" })).status, 409, "the slot is taken");
  const cancel = await api("PUT", "/appointments/entries/" + a.json.id, { token, body: { ...a.json.appointment, status: "Cancelled", cancellation_reason: "Patient called" } });
  eq(cancel.status, 200, cancel.text);
  const again = await book(api, token, ids, { patient_name: "Someone Else" });
  eq(again.status, 201, "after cancelling, the same slot can be booked: " + again.text);
});

test("appointments: public lookup hides staff notes and is rate-limited per network", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const ids = await setup(api, token);
  const a = await book(api, token, ids);
  const t = a.json.token;
  const ip = { "CF-Connecting-IP": "198.51.100.7" };
  const look = await api("GET", "/appointments/public/lookup?id_card=12345m&token=" + t, { headers: ip });
  eq(look.status, 200, look.text);
  eq(look.json.appointment.notes, undefined, "staff notes are not shown to the public");
  ok(!/owes/.test(look.text), "note text absent");
  for (let i = 0; i < 25; i++) await api("GET", "/appointments/public/lookup?id_card=X&token=ZZZZ", { headers: ip });
  eq((await api("GET", "/appointments/public/lookup?id_card=12345m&token=" + t, { headers: ip })).status, 429, "guessing network is stopped");
  eq((await api("GET", "/appointments/public/lookup?id_card=12345m&token=" + t, { headers: { "CF-Connecting-IP": "203.0.113.4" } })).status, 200, "other networks unaffected");
});

test("appointments: when the list is capped, the newest bookings are kept, oldest-first", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  for (const d of ["2026-01-05", "2026-06-10", "2026-12-01"]) {
    eq((await api("POST", "/appointments/entries", { token, body: { patient_name: "P " + d, date: d, time: "10:00" } })).status, 201);
  }
  const r = await api("GET", "/appointments/entries?limit=2", { token });
  eq(r.status, 200, r.text);
  eq(r.json.appointments.map((a) => a.date), ["2026-06-10", "2026-12-01"]);
});
