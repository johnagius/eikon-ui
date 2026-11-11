// Helpers shared by the cases in tests/real/cases/. One `t` per case: its own browser context(s), checks, and the
// column comparison (classic row vs new-layout row, every column; only the listed columns may differ).
import { maltaYmd, contextTz, prepareContext } from "../clock.mjs";
import { watchCsp } from "../csp.mjs";
// Every Content-Security-Policy violation of the whole run (security audit 2026-11-10): a case with one fails, and the
// tail counts them.
export const CSPV = [];
// Malta's calendar day n days from today: the day the worker's /today, the header and a browser in Malta call today
// (the machine running the tests is on UTC, which is a day behind for an hour or two around midnight).
export const ymd = (n = 0) => maltaYmd(n);
const show = (v) => v === undefined ? "(missing)" : v === null ? "null" : JSON.stringify(v).slice(0, 240);
// Always allowed to differ: the row's own id and clock stamps.
const ALWAYS = ["id", "created_at", "updated_at"];

export function makeT({ browser, stack, token, name }) {
  const ctxs = [], pageErrs = [], cspSeen = [];
  const t = {
    name, checks: 0, fails: [], notes: [], known: [], stack, token, base: stack.base + "/ui/index.html",
    ok(c, m) { t.checks++; if (!c) t.fails.push(m); return !!c; },
    fail(m) { t.checks++; t.fails.push(m); },
    note(m) { t.notes.push(m); },

    // A signed-in page. Every request that is not to localhost is aborted.
    async page({ phone = false, dialogs = "accept" } = {}) {
      // in Malta's time zone, like the pharmacies' devices (tests/clock.mjs: EIKON_BROWSER_TZ, EIKON_FAKE_NOW)
      const ctx = await prepareContext(await browser.newContext({ ...(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 900 } }), ...contextTz() }));
      ctxs.push(ctx);
      await watchCsp(ctx, (txt, u) => { cspSeen.push(txt + " (" + u + ")"); CSPV.push(name + ": " + txt); });
      await ctx.addInitScript((tok) => { try { if (!localStorage.getItem("eikon_token")) localStorage.setItem("eikon_token", tok); if (!localStorage.getItem("eikon_active_role")) localStorage.setItem("eikon_active_role", "pharmacy"); } catch (e) {} }, token);
      await ctx.route("**/*", (r) => { const u = r.request().url(); return /^(about|blob|data):/.test(u) || new URL(u).hostname === "localhost" ? r.continue() : r.abort(); });
      const p = await ctx.newPage(); p.setDefaultTimeout(10000);
      p.__pending = new Map(); const api = (r) => r.resourceType() === "fetch" || r.resourceType() === "xhr";
      p.on("request", (r) => { if (api(r)) p.__pending.set(r, Date.now()); });
      for (const ev of ["requestfinished", "requestfailed"]) p.on(ev, (r) => { p.__pending.delete(r); });
      p.on("pageerror", (e) => pageErrs.push(e.message));
      if (dialogs) p.on("dialog", (d) => (dialogs === "accept" ? d.accept() : d.dismiss()).catch(() => {}));
      return p;
    },
    // Open a screen: layout "classic" (the old screen, one visit) or "2" (the new layout); waits for the module.
    async open(p, layout, hash, moduleId, readySel) {
      await p.goto(t.base + "?ui=" + layout + "#" + hash);
      try { await p.waitForFunction((m) => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === m, moduleId, { timeout: 20000 }); }
      catch (e) { const st = await p.evaluate(() => ({ mod: window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId, url: location.href, text: document.body.innerText.slice(0, 200) })).catch(() => ({})); throw new Error(`${moduleId} did not open: ${JSON.stringify(st)}`); }
      if (readySel) await p.waitForSelector(readySel, { timeout: 15000 });
      await t.idle(p); // the screen's first reads are back (and drawn) before anything is typed
    },
    // Fill fields one by one, letting each field's change handlers (autofill from history) run before the next is
    // typed, then check every value stuck. `sel` maps a selector (or a [name=…] under `scope`) to its value.
    async fill(p, scope, map) {
      const q = (k) => p.locator(/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? (scope ? scope + " " : "") + "[name=" + k + "]" : k).first();
      for (const [k, v] of Object.entries(map)) { await q(k).fill(String(v)); await q(k).evaluate((e) => e.blur()); await p.waitForTimeout(30); }
      for (const [k, v] of Object.entries(map)) if (await q(k).inputValue() !== String(v)) { await q(k).fill(String(v)); await q(k).evaluate((e) => e.blur()); }
    },
    // Run `action` and wait for the write it causes (method + path regex); returns the reply JSON.
    async write(p, re, action, method = "POST") {
      let res;
      try { [res] = await Promise.all([p.waitForResponse((r) => r.request().method() === method && re.test(new URL(r.url()).pathname), { timeout: 15000 }), action()]); }
      catch (e) { if (process.env.REAL_SHOTS) await p.screenshot({ path: process.env.REAL_SHOTS + "/" + name + "-" + Date.now() + ".png", fullPage: true }).catch(() => {}); const txt = await p.evaluate(() => (document.querySelector(".eikon-modal-overlay:not([style*='none']), .eikon-dda-modal-backdrop, .eikon-content") || document.body).innerText.replace(/\s+/g, " ").slice(0, 400)).catch(() => ""); throw new Error(`no ${method} ${re} after the save: ${e.message.split("\n")[0]} · screen: ${txt}`); }
      let j = null; try { j = await res.json(); } catch (e) {}
      if (res.status() >= 400) t.fail(`${method} ${new URL(res.url()).pathname} answered ${res.status()}: ${JSON.stringify(j).slice(0, 160)}`);
      return { status: res.status(), json: j, body: res.request().postDataJSON ? safe(() => res.request().postDataJSON()) : null };
    },
    async api(method, path, body) { const r = await stack.app.api(method, path, { token, body }); return r.json; },
    db: stack.app.DB.db,
    maxId(table) { try { return Number(t.db.prepare(`SELECT COALESCE(MAX(id),0) AS m FROM ${table}`).get().m); } catch (e) { if (/no such table/.test(e.message)) return 0; throw e; } },
    // Rows written since `id`. Cases run in parallel and several write the same tables (the tab sweep writes nearly
    // all of them, and seeds a repeat prescription, a locum receipt and an order), so a case picks its own rows by
    // `match`, values only it uses ({ column: value }, compared as text).
    since(table, id, match) {
      const rows = t.db.prepare(`SELECT * FROM ${table} WHERE id > ? ORDER BY id`).all(id);
      return match ? rows.filter((r) => Object.entries(match).every(([k, v]) => String(r[k]) === String(v))) : rows;
    },
    // The same, waiting (up to `ms`) until at least `n` such rows are there: a save answers before a slow parallel
    // run lets the next read see it, and some screens write in the background after the reply.
    async mine(table, id, match, n = 1, ms = 5000) {
      for (let waited = 0; ; waited += 100) { const r = t.since(table, id, match); if (r.length >= n || waited >= ms) return r; await new Promise((ok) => setTimeout(ok, 100)); }
    },
    // Wait until this page has had no request to the API in flight for `quiet` ms (a screen still loading redraws
    // after the reply: typing or a key press before that can land on a field that is about to be replaced).
    // A request that has been open for `stale` ms is not waited for (a screen that drops a superseded read leaves it
    // open in the browser's books for good).
    async idle(p, quiet = 300, ms = 10000, stale = 4000) {
      const t0 = Date.now(); let calm = 0;
      const open = () => [...(p.__pending || new Map())].filter(([, at]) => Date.now() - at < stale);
      while (Date.now() - t0 < ms) { if (!open().length) { calm += 50; if (calm >= quiet) return true; } else calm = 0; await p.waitForTimeout(50); }
      t.note("still loading after " + ms + " ms: " + open().map(([r]) => r.method() + " " + new URL(r.url()).pathname).join(", "));
      return false;
    },
    row(table, id) { return t.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id); },

    // Every column of the new-layout row equals the classic row, except ALWAYS and `allow` ({ column: why }): the
    // differences that are by design. `known` ({ column: what }) lists differences found by this suite and not yet
    // fixed in the app: reported in the tail as KNOWN, not failed, so the suite stays a regression gate; when one is
    // fixed the tail says so and it should be taken off the list.
    same(label, classic, fresh, allow = {}, known = {}) {
      if (!t.ok(classic && fresh, `${label}: ${!classic ? "the classic screen" : "the new screen"} stored no row`)) return;
      const keys = [...new Set([...Object.keys(classic), ...Object.keys(fresh)])].sort();
      for (const k of keys) {
        if (ALWAYS.includes(k)) continue;
        const a = classic[k], b = fresh[k], eq = JSON.stringify(a) === JSON.stringify(b);
        if (k in known) { if (!eq) { t.known.push(`${label}.${k}: ${known[k]} (classic ${show(a)}, new ${show(b)})`); } else t.note(`${label}.${k} KNOWN difference is gone: take it off the list`); continue; }
        if (k in allow) { if (!eq) t.note(`${label}.${k} differs as documented (${allow[k]}): classic ${show(a)}, new ${show(b)}`); else t.note(`${label}.${k} listed as a known difference but now equal`); continue; }
        t.ok(eq, `${label}: column ${k}: classic stored ${show(a)}, new screen stored ${show(b)}`);
      }
    },
    // A copy of `row` with a JSON column parsed, the `drop` keys removed (at any depth) and keys sorted, so two rows
    // can be compared field by field inside the JSON.
    jsonCol(row, col, drop = []) {
      if (!row) return row;
      const norm = (v) => Array.isArray(v) ? v.map(norm) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => !drop.includes(k)).map((k) => [k, norm(v[k])])) : v;
      let v; try { v = JSON.parse(row[col]); } catch (e) { return row; }
      return { ...row, [col]: JSON.stringify(norm(v)) };
    },
    // The values the inputs should have produced (so a field both screens drop is caught too).
    has(label, row, want) {
      if (!t.ok(row, `${label}: no row stored`)) return;
      for (const [k, v] of Object.entries(want)) t.ok(JSON.stringify(row[k]) === JSON.stringify(v), `${label}: column ${k} should be ${show(v)}, stored ${show(row[k])}`);
    },
    async close() {
      for (const e of pageErrs) t.fail("page error: " + e.slice(0, 200));
      for (const v of [...new Set(cspSeen)]) t.fail("CSP violation: " + v.slice(0, 240));
      for (const c of ctxs) await c.close().catch(() => {});
    },
  };
  return t;
}
function safe(f) { try { return f(); } catch (e) { return null; } }
