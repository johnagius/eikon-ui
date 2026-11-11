// The local real stack for tests/real: the REAL worker (cloudflare-worker/code) on an in-memory SQLite D1
// (tests/worker/harness.mjs), and ui/ served from the same port. Seeded once. Never talks to a live server:
// email providers are stubbed, and the browser aborts every request that is not to localhost.
// Seeding follows the scratchpad tools/serve.mjs used by the earlier one-off real-stack scripts.
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { makeApp } from "../worker/harness.mjs";
import { maltaYmd } from "../clock.mjs";
import { cspHeadersFor } from "../csp.mjs"; // pages carry the worker's own CSP (report-only, or CSP_ENFORCE=1)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const USER = { email: "maria@demo.mt", password: "Demo-Pass-2026", name: "Maria Borg" };

export async function startStack(port) {
  const app = await makeApp({ allowedOrigins: "http://localhost:" + port, env: { BOOKINGS_KEY: "local-test-bookings-key-0123456789", PUBLIC_BASE_URL: "http://localhost:" + port } });
  globalThis.__sentEmails = []; const origFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    if (/api\.resend\.com|api\.brevo\.com/.test(String(u))) { globalThis.__sentEmails.push({ url: String(u) }); return new Response('{"id":"stub"}'); }
    const h = new URL(String(u.url || u)).hostname;
    if (h !== "localhost" && h !== "127.0.0.1") throw new Error("tests/real: outbound request blocked: " + String(u.url || u));
    return origFetch(u, init);
  };
  const s = await app.bootstrap({ email: USER.email, password: USER.password, name: USER.name, location: "Demo Pharmacy", org: "Demo Org" });
  const T = s.token; const d = (n) => maltaYmd(-n); // n days back, Malta's calendar (as the screens date them)
  const seed = async (m, p, body) => { const r = await app.api(m, p, { token: T, body }); if (r.status >= 400) throw new Error("seed failed " + p + " " + r.status + " " + r.text.slice(0, 160)); return r; };
  const devs = (await app.api("GET", "/temperature/devices", { token: T })).json?.devices || [];
  for (let i = 1; i <= 6; i++) for (const dv of devs.slice(0, 2)) await seed("POST", "/temperature/entries", { device_id: dv.id, entry_date: d(i), min_temp: 3 + (i % 2) * 0.4, max_temp: 6 + (i % 3) * 0.3, notes: "" });
  await seed("POST", "/cleaning/entries", { entry_date: d(2), time_in: "08:00", time_out: "08:40", cleaner_name: "Karl", staff_name: "Maria", notes: "" });
  const sales = [["Zammit Carmel", "0012345M", "Morphine 10mg/ml", 2, "Dr Abela"], ["Grech Joseph", "0456789M", "Alprazolam 0.5mg", 1, "Dr Galea"], ["Vella Anna", "0987654M", "Cannabis 22/1 x10g", 1, "Dr Camilleri"]];
  let k = 0; for (const [n, id, med, q, doc] of sales) await seed("POST", "/dda-sales/entries", { entry_date: d(k++), client_name: n, client_id_card: id, client_address: "1 Triq il-Knisja, Valletta", medicine_name_dose: med, quantity: q, doctor_name: doc, doctor_reg_no: "R" + (1200 + k), prescription_serial_no: "S" + (5000 + k) });

  const TYPES = { html: "text/html", js: "application/javascript", css: "text/css", png: "image/png", svg: "image/svg+xml", json: "application/json", woff2: "font/woff2" };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost"); const p = decodeURIComponent(u.pathname);
    if (p.startsWith("/ui/")) {
      const f = path.join(ROOT, "ui", p.slice(4));
      if (f.startsWith(path.join(ROOT, "ui")) && fs.existsSync(f) && fs.statSync(f).isFile() && /\.html?$/i.test(f)) {
        const html = fs.readFileSync(f, "utf8");
        return void cspHeadersFor(path.relative(path.join(ROOT, "ui"), f), html).then((h) => { res.writeHead(200, { "content-type": "text/html", ...h }); res.end(html); }, (e) => { res.writeHead(500); res.end(String(e)); });
      }
      if (f.startsWith(path.join(ROOT, "ui")) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { "content-type": TYPES[f.split(".").pop()] || "application/octet-stream" }); return fs.createReadStream(f).pipe(res); }
    }
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
  await new Promise((ok, bad) => { server.once("error", bad); server.listen(port, "localhost", ok); });
  return { app, token: T, server, base: "http://localhost:" + port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
