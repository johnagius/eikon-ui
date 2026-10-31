// Minimal test runner for the worker. Run: node tests/worker/run.mjs [filter]
// Each test gets a fresh in-memory database and a bootstrapped admin session.
import { makeApp } from "./harness.mjs";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const filter = process.argv[2] || "";
import { tests } from "./lib.mjs";

// Load every *.test.mjs in this folder.
for (const f of readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort()) {
  await import(join(here, f));
}

let pass = 0, fail = 0;
const failures = [];
for (const t of tests) {
  if (filter && !t.name.includes(filter)) continue;
  const app = await makeApp();
  const t0 = Date.now();
  try {
    await t.fn(app);
    pass++;
    console.log(`  ok   ${t.name} (${Date.now() - t0} ms)`);
  } catch (e) {
    fail++;
    failures.push({ name: t.name, err: e });
    console.log(`  FAIL ${t.name}\n       ${String(e && e.stack || e).split("\n").slice(0, 6).join("\n       ")}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed, ${tests.length} total`);
process.exit(fail ? 1 : 0);
