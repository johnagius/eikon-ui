// Help matches the screen (BACKLOG5 item 9). Shared by tests/ui/run.mjs (mock API) and tests/real/cases/helpmatch.mjs
// (real worker, a busy pharmacy). Three checks on ui/help-next.js against the screens:
//   1. words: every "Press X" in a guide names a button the screen's own code draws (its module, the month bar, Correct,
//      or Today's rows), so a renamed button cannot leave the guide behind;
//   2. footer: the sentences of a screen's footer that say what is still in the classic screen are, word for word, the
//      guide's "Still in the classic screen" paragraph, and the guide claims nothing more there;
//   3. buttons: that paragraph never names a button the screen really has (as "Print on A4", "New return", Undo).
// Plus no technical words in any guide.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const plain = (s) => String(s || "").replace(/\\u2019|&rsquo;|[‘’]/g, "'").replace(/&amp;/g, "&").replace(/\\u2026/g, "…").replace(/\s+/g, " ").trim();
const norm = (s) => plain(s).toLowerCase();
const sentences = (s) => norm(s).split(/(?<=[.!?])\s+(?=[a-z0-9"'(])/).map((x) => x.replace(/[.\s]+$/, "")).filter(Boolean);
export const isClassicSentence = (s) => /\b(in|use) the classic\b/.test(norm(s));

export function loadGuides(root) {
  const win = { EIKON: { escapeHtml: (s) => s, modules: {}, state: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "help-next.js"), "utf8"), { window: win, document: {} });
  const H = win.EIKON.helpNext, out = {};
  H.guides().forEach((id) => { out[id] = H.guide(id); });
  return out;
}

// id -> its module file, from the "new" rows of registry.js
export function newScreens(root) {
  const reg = fs.readFileSync(path.join(root, "registry.js"), "utf8");
  return [...reg.matchAll(/\["([^"]+)", "([^"]+)", "[^"]*", "[^"]*", \d+, (?:true|false), "new"/g)].map((m) => ({ file: m[1], id: m[2] }));
}

// "Press X" (X up to the first stop) in every step of every guide.
const STOP = /[.,;:(]| (?:on|for|when|to|if|beside|with|again|then|or|under|at|so|in)\b/;
export function pressPhrases(g) {
  const out = [];
  g.tasks.forEach((t) => t.slice(1).forEach((st) => {
    st = String(st);
    for (const m of st.matchAll(/\b[Pp]ress /g)) {
      let rest = st.slice(m.index + 6); const cut = rest.search(STOP); if (cut >= 0) rest = rest.slice(0, cut);
      rest = rest.trim(); if (rest && rest[0] !== "/" && rest !== "Enter") out.push(rest);
    }
  }));
  return [...new Set(out)];
}

export function staticCheck(root) {
  const G = loadGuides(root), screens = newScreens(root), problems = [];
  const read = (f) => { try { return plain(fs.readFileSync(path.join(root, f), "utf8")); } catch (e) { return ""; } };
  const shared = ["eikon.months.js", "eikon.correct.js", "modules.today.js"].map(read).join("\n");
  const jargon = /\b(worker|deploy(ed)?|UI|API|CSP|commit|endpoint|localStorage|D1|wrangler|bug|debounce|JSON|cache|server|sync(ed|s)?|upsert|IndexedDB|token|module|hash|null|undefined)\b/i;
  for (const { id, file } of screens) {
    const g = G[id]; if (!g) { problems.push(id + ": no guide"); continue; }
    const src = read(file) + "\n" + shared + (id === "stock" ? "\n" + read("modules.stkflow.js") : ""); // the Stock tab draws its ordering flow from its own file (d-stock)
    // as drawn: the start of a text or a string in the code (>Save entry<, "Save entry", 'Book ' + day), not any word in it
    pressPhrases(g).forEach((ph) => { const w = plain(ph); if (![">", '"', "'"].some((q) => src.indexOf(q + w) >= 0)) problems.push(id + ': "Press ' + ph + '" names no button on the screen'); });
    const all = [g.title, g.purpose, g.classic].concat(...g.tasks).concat(...g.words.map((w) => w.join(" "))).join(" ");
    const j = all.match(jargon); if (j) problems.push(id + ": technical word (" + j[0] + ")");
    if (/\bclassic\b/i.test(g.classic) === false && g.classic) problems.push(id + ": the classic paragraph does not say what is in the classic screen");
  }
  return problems;
}

// The words of a label, light stems, little words left out: "Printing it on A4" and "Print on A4" both give print on a4.
const FILL = new Set(["it", "its", "the", "a", "an", "this", "that", "your", "one"]);
const stems = (s) => norm(s).replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w && !FILL.has(w)).map((w) => w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w.replace(/s$/, ""));
const containsSeq = (hay, needle) => { for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, k) => hay[i + k] === w)) return true; return false; };
const ONE_WORD = new Set(["undo", "correct", "renew", "void", "unlock", "delete…", "edit"]);

// footer: the text of the screen's classic footer(s); labels: the visible buttons and links of the screen.
export function compare(id, g, footer, labels) {
  const problems = [];
  const fs_ = footer.flatMap(sentences).filter(isClassicSentence), gs = sentences(g ? g.classic : "");
  fs_.forEach((s) => { if (gs.indexOf(s) < 0) problems.push(id + ': the screen says "' + s + '" but the guide does not'); });
  if (fs_.length) gs.forEach((s) => { if (fs_.indexOf(s) < 0) problems.push(id + ': the guide says "' + s + '" is still classic, the screen does not'); });
  const hay = stems(g ? g.classic : "");
  [...new Set(labels.map(norm))].forEach((l) => {
    if (!l || l.length > 40 || /\d{2,}|\d[.,:]\d/.test(l) || /classic/.test(l)) return; // dates, times, amounts and names are not button names
    const st = stems(l); if (!st.length || st.length > 5) return;
    if (st.length === 1 && !ONE_WORD.has(l)) return;
    if (containsSeq(hay, st)) problems.push(id + ': the guide says "' + l + '" is in the classic screen, but the screen has it');
  });
  return problems;
}

// In the page: the classic footer(s) and the visible buttons and links of the open screen.
export function readScreenInPage() {
  const m = document.querySelector("#eikon-content") || document.body;
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const footer = [...new Set([...m.querySelectorAll('[data-act="classic"]')].map((a) => (a.closest("p") || a.parentElement).innerText))];
  const labels = [...m.querySelectorAll("button, a, [role=tab]")].filter(vis).filter((e) => e.getAttribute("data-act") !== "classic" && e.getAttribute("data-act") !== "back").map((e) => (e.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return { footer, labels };
}
