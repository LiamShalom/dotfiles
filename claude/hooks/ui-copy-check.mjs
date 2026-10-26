#!/usr/bin/env node
// PostToolUse (Edit|Write|MultiEdit): when an edit to a React UI file adds a lot of on-screen
// text, tell the agent before it moves on. Text-heavy components are the operator's most
// repeated design complaint, and the prose rule in CLAUDE.md did not stop them. Runs only
// for .tsx under app/ or components/ (node starts on every edit and exits at once for other files), and
// only counts text that the edit adds, so touching a file with existing copy stays silent.
import { appendFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const LONGEST = 16; // words in one text run
const TOTAL = 40; // words added by one edit

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const ti = input.tool_input ?? {};
const file = ti.file_path ?? '';
if (!/\.tsx$/.test(file) || !/\/(app|components)\//.test(file)) process.exit(0);
if (/(\.test|\.spec|\.stories)\.tsx$|__tests__|fixture|\/app\/dev-/i.test(file)) process.exit(0);

const pairs =
  input.tool_name === 'Write'
    ? [['', ti.content ?? '']]
    : input.tool_name === 'MultiEdit'
      ? (ti.edits ?? []).map((e) => [e.old_string ?? '', e.new_string ?? ''])
      : [[ti.old_string ?? '', ti.new_string ?? '']];

const words = (s) => s.split(/\s+/).filter(Boolean);
// Class lists, paths, keys and identifiers are not copy: prose has mostly plain words.
const isProse = (s) => {
  const w = words(s);
  if (w.length < 4) return false;
  if (/^(\.{0,2}\/|@\/|https?:)/.test(s)) return false;
  const plain = w.filter((t) => /^[A-Za-z'’]+[.,!?:;)]*$/.test(t.replace(/^[("“]/, ''))).length;
  return plain / w.length >= 0.7 && /[A-Z]|[.?!]$/.test(s.trim());
};
const runs = (src) => {
  const out = [];
  const lines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|import )/.test(l));
  const code = lines.join('\n');
  for (const m of code.matchAll(/>([^<>{}]+)</g)) out.push(m[1]);
  for (const m of code.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.){12,})\1/g)) {
    const before = code.slice(Math.max(0, m.index - 12), m.index);
    if (/className=\s*$|cn\(\s*$/.test(before)) continue;
    out.push(m[2]);
  }
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter(isProse);
};

const added = [];
for (const [oldS, newS] of pairs) {
  const before = new Set(runs(oldS));
  for (const r of runs(newS)) if (!before.has(r)) added.push(r);
}
if (!added.length) process.exit(0);

const total = added.reduce((n, r) => n + words(r).length, 0);
const longest = added.reduce((a, r) => (words(r).length > words(a).length ? r : a), '');
const longN = words(longest).length;
if (longN < LONGEST && total < TOTAL) process.exit(0);

try {
  appendFileSync(
    `${homedir()}/.claude/logs/ui-copy-check.log`,
    `${new Date().toISOString()}\t${file}\ttotal=${total}\tlongest=${longN}\t${longest.slice(0, 160)}\n`,
  );
} catch {}

const quote = longest.length > 140 ? `${longest.slice(0, 140)}…` : longest;
const msg =
  `UI copy check: this edit adds ${total} words of on-screen text (longest run ${longN} words: "${quote}"). ` +
  `Text-heavy components are the operator's most repeated design complaint. Before moving on, cut it: ` +
  `can a label, number, icon, status chip, or the layout itself say this? Keep only words that change what ` +
  `the user does next; a definition goes in a short tooltip; no explainer, caveat or "how this works" blocks. ` +
  `Match the word count of the closest shipped screen. Taste file: ~/dotfiles/claude/references/ui-taste.md. ` +
  `If every word is needed (a legal notice, a real error, a form label set), keep it and say why in one line.`;
process.stdout.write(
  JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msg } }),
);
