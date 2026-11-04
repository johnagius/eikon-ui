// A Cloudflare D1 look-alike over Node's built-in SQLite (node:sqlite, Node 22+).
// Enough of the D1 surface for the worker: prepare().bind().first()/all()/run()/raw(),
// exec(), batch(). Used only by the test harness; never shipped.
import { DatabaseSync } from "node:sqlite";

function normBind(v) {
  if (v === undefined) return null;
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === "bigint") return Number(v);
  return v;
}

// Under a faked clock (tests/clock.mjs EIKON_FAKE_NOW), SQLite's 'now' follows it too, so session expiry, rate windows
// and the rows' stamps agree with the worker's Date. Table definitions keep 'now' (their DEFAULTs are evaluated per row).
function fakeNow(sql) {
  if (!globalThis.Date.__eikonFake || sql.indexOf("'now'") < 0 || /^\s*CREATE\s/i.test(sql)) return sql;
  return sql.replace(/'now'/g, "'" + new Date().toISOString().slice(0, 19).replace("T", " ") + "'");
}

class D1Stmt {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new D1Stmt(this.db, this.sql, params.map(normBind));
  }
  _prep() {
    return this.db.prepare(fakeNow(this.sql));
  }
  async first(col) {
    const row = this._prep().get(...this.params);
    if (row === undefined) return null;
    if (col) return row[col] === undefined ? null : row[col];
    return row;
  }
  async all() {
    const results = this._prep().all(...this.params);
    return { results, success: true, meta: { duration: 0, rows_read: results.length } };
  }
  async raw() {
    const rows = this._prep().all(...this.params);
    return rows.map((r) => Object.values(r));
  }
  async run() {
    const stmt = this._prep();
    // SELECT or RETURNING statements still "run" in D1; node:sqlite's run() on a
    // statement that returns rows is fine (rows are discarded).
    const r = stmt.run(...this.params);
    return {
      success: true,
      meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0), duration: 0 }
    };
  }
}

export class D1Shim {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = OFF;");
    // A whole run under EIKON_FAKE_NOW: SQLite's date functions read 'now' from the faked clock everywhere, the
    // tables' DEFAULT (datetime('now')) included (a second, plain connection does the date arithmetic).
    if (process.env.EIKON_FAKE_NOW) {
      const aux = new DatabaseSync(":memory:");
      for (const fn of ["datetime", "date", "time", "julianday", "strftime", "unixepoch"])
        this.db.function(fn, { varargs: true, deterministic: false }, (...a) => aux.prepare("SELECT " + fn + "(" + a.map(() => "?").join(",") + ") AS v").get(...a.map((v) => v === "now" ? new Date().toISOString().slice(0, 19).replace("T", " ") : v)).v);
    }
  }
  prepare(sql) {
    return new D1Stmt(this.db, sql);
  }
  async exec(sql) {
    this.db.exec(sql);
    return { count: 1, duration: 0 };
  }
  async batch(stmts) {
    const out = [];
    this.db.exec("BEGIN");
    try {
      for (const s of stmts) out.push(await s.run());
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return out;
  }
  // test helpers
  q(sql, ...params) {
    return this.db.prepare(sql).all(...params.map(normBind));
  }
  one(sql, ...params) {
    return this.db.prepare(sql).get(...params.map(normBind)) ?? null;
  }
}
