// Shared by the runner and the test files (kept separate to avoid an import cycle).
export const tests = [];
export function test(name, fn) { tests.push({ name, fn }); }
export function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || "expected equal") + "\n  got:      " + JSON.stringify(a) + "\n  expected: " + JSON.stringify(b));
}
export function ok(v, msg) { if (!v) throw new Error(msg || "expected truthy, got " + JSON.stringify(v)); }
