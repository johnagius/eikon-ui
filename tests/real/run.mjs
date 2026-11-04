// Real-stack regression suite: each new-layout screen that writes is driven through the UI, the stored row is read
// back, and every column is compared with what the classic screen stores for the same input.
//   node --no-warnings tests/real/run.mjs            all cases
//   node --no-warnings tests/real/run.mjs ordreg cds  cases whose file name contains one of the words
// Env: REAL_PORT (default 8895), REAL_JOBS (parallel browser contexts, default 4), REAL_HEADED=1.
import { createRequire } from "node:module"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath, pathToFileURL } from "node:url";
import { startStack, USER } from "./stack.mjs";
import { makeT } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)("playwright");
const PORT = Number(process.env.REAL_PORT || 8895), JOBS = Math.max(1, Number(process.env.REAL_JOBS || 4));
const want = process.argv.slice(2);
const files = fs.readdirSync(path.join(here, "cases")).filter((f) => f.endsWith(".mjs") && !f.startsWith("_")).sort()
  .filter((f) => !want.length || want.some((w) => f.includes(w)));

const out = (s) => process.stdout.write(s + "\n");
// The worker and the pages log freely; keep the output to the suite's own lines (REAL_VERBOSE=1 shows them).
if (!process.env.REAL_VERBOSE) for (const k of ["log", "info", "warn", "debug", "error"]) console[k] = () => {};
const t0 = Date.now();
const stack = await startStack(PORT);
const login = await stack.app.api("POST", "/auth/login", { body: { email: USER.email, password: USER.password } });
if (!login.json?.ok) throw new Error("login failed " + login.text);
const browser = await chromium.launch({ headless: !process.env.REAL_HEADED });
const results = [];
// The correct-* cases write extra lines into the same tables as the screens' own cases, which find their row as "the
// newest one": they run after all the others (in parallel among themselves: each uses its own table).
// typerace writes orders, questions and deliveries too: it runs with them, after the cases that read "the newest row" there.
// "solo-" cases add rows to several of those tables: they run last, one at a time.
const lateCase = (f) => f.startsWith("correct-") || f === "typerace.mjs";
const queue = files.filter((f) => !lateCase(f) && !f.startsWith("solo-")), later = files.filter(lateCase), solo = files.filter((f) => f.startsWith("solo-"));
async function worker() {
  while (queue.length) {
    const f = queue.shift();
    const mod = (await import(pathToFileURL(path.join(here, "cases", f)).href)).default;
    const t = makeT({ browser, stack, token: login.json.token, name: f.replace(/\.mjs$/, "") });
    const c0 = Date.now();
    try { await mod.run(t); } catch (e) { t.fail("threw: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e)); }
    await t.close();
    const r = { name: t.name, title: mod.title || t.name, checks: t.checks, fails: t.fails, notes: t.notes, known: t.known, ms: Date.now() - c0 };
    results.push(r);
    out((r.fails.length ? "FAIL " : "ok   ") + r.name.padEnd(12) + " " + String(r.checks).padStart(3) + " checks  " + (r.ms / 1000).toFixed(1) + "s" + (r.fails.length ? "\n" + r.fails.map((x) => "       - " + x).join("\n") : ""));
  }
}
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, worker));
queue.push(...later);
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, worker));
queue.push(...solo);
await worker();
await browser.close(); await stack.close();

results.sort((a, b) => a.name < b.name ? -1 : 1);
const failed = results.filter((r) => r.fails.length);
out("\n=== tail ===");
if (process.env.REAL_NOTES) for (const r of results) if (r.notes.length) out("note " + r.name + ": " + r.notes.join(" | "));
for (const r of results) for (const k of r.known) out("KNOWN " + r.name + ": " + k);
for (const r of failed) { out("FAILED " + r.name + " (" + r.title + ")"); for (const x of r.fails) out("  - " + x); }
out(`real: ${results.length - failed.length} passed, ${failed.length} failed (${results.reduce((n, r) => n + r.checks, 0)} checks, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
process.exit(failed.length ? 1 : 0);
