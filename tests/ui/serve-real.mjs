// Serves ui/ and answers API calls with the real worker on an in-memory SQLite D1. Never contacts the live site; email providers are stubbed.
// Local full stack: serves <tree>/ui and answers API calls with the REAL worker from <tree>
// on an in-memory SQLite D1. Never talks to the live site.
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { pathToFileURL } from "node:url";
const [tree, port] = [process.argv[2], Number(process.argv[3])];
const { makeApp } = await import(pathToFileURL(path.join(tree, "tests/worker/harness.mjs")).href);
const app = await makeApp({ allowedOrigins: "http://localhost:" + port, env: { BOOKINGS_KEY: "local-test-bookings-key-0123456789", PUBLIC_BASE_URL: "http://localhost:" + port } });
// Local only: email providers are stubbed so nothing is ever sent.
globalThis.__sentEmails = []; const __origFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => { if (/api\.resend\.com|api\.brevo\.com/.test(String(u))) { globalThis.__sentEmails.push({ url: String(u), body: JSON.parse(init.body) }); return new Response('{"id":"stub"}'); } return __origFetch(u, init); };
const s = await app.bootstrap({ email: "maria@demo.mt", password: "Demo-Pass-2026", name: "Maria Borg", location: "Demo Pharmacy", org: "Demo Org" });
const T = s.token; const d = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const seed = async (m, p, body) => { const r = await app.api(m, p, { token: T, body }); if (r.status >= 400) console.log("seed fail", p, r.status, r.text.slice(0, 120)); return r; };
const devs = (await app.api("GET", "/temperature/devices", { token: T })).json?.devices || [];
for (let i = 1; i <= 6; i++) for (const dv of devs.slice(0, 2)) await seed("POST", "/temperature/entries", { device_id: dv.id, entry_date: d(i), min_temp: 3 + (i % 2) * 0.4, max_temp: 6 + (i % 3) * 0.3, notes: "" });
await seed("POST", "/cleaning/entries", { entry_date: d(2), time_in: "08:00", time_out: "08:40", cleaner_name: "Karl", staff_name: "Maria", notes: "" });
const sales = [["Zammit Carmel","0012345M","Morphine 10mg/ml",2,"Dr Abela"],["Grech Joseph","0456789M","Alprazolam 0.5mg",1,"Dr Galea"],["Vella Anna","0987654M","Cannabis 22/1 x10g",1,"Dr Camilleri"]];
let k = 0; for (const [n, id, med, q, doc] of sales) await seed("POST", "/dda-sales/entries", { entry_date: d(k++), client_name: n, client_id_card: id, client_address: "1 Triq il-Knisja, Valletta", medicine_name_dose: med, quantity: q, doctor_name: doc, doctor_reg_no: "R" + (1200 + k), prescription_serial_no: "S" + (5000 + k) });
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost"); let p = decodeURIComponent(u.pathname);
  if (p === "/__emails") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(globalThis.__sentEmails)); }
  if (p.startsWith("/ui/")) { const f = path.join(tree, "ui", p.slice(4)); if (fs.existsSync(f) && fs.statSync(f).isFile()) { const ext = f.split(".").pop(); res.writeHead(200, { "content-type": ({ html: "text/html", js: "application/javascript", css: "text/css", png: "image/png", svg: "image/svg+xml" })[ext] || "application/octet-stream" }); return fs.createReadStream(f).pipe(res); } }
  const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", async () => {
    const h = {}; for (const [kk, v] of Object.entries(req.headers)) if (!["host", "content-length", "connection"].includes(kk)) h[kk] = v;
    const body = chunks.length ? Buffer.concat(chunks).toString() : undefined;
    try {
      const r = await app.api(req.method, u.pathname + u.search, { headers: h, body: req.method === "GET" || req.method === "HEAD" ? undefined : body });
      const out = {}; r.headers.forEach((v, kk) => { if (kk !== "content-length" && kk !== "content-encoding") out[kk] = v; });
      res.writeHead(r.status, out); res.end(r.text);
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
});
server.listen(port, () => console.log("READY", tree, port));
