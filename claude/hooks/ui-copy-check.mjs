#!/usr/bin/env node
// PostToolUse (Edit|Write|MultiEdit): when an edit to a UI file adds a lot of on-screen text,
// tell the agent before it moves on. Text-heavy components are the operator's most repeated
// design complaint, and the prose rule in CLAUDE.md did not stop them. Covers web .tsx under
// app/ or components/, iOS .swift in UI folders, and Android .kt (node starts on every edit and
// exits at once for other files). Only text the edit adds counts, so touching a file with
// existing copy stays silent.
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
const kind = /\.tsx$/.test(file) && /\/(app|components)\//.test(file)
  ? 'tsx'
  : (/\.swift$/.test(file) && /\/(UI|Views?|Components?|Screens?|Widget)\//.test(file)) || (/\.kt$/.test(file) && /\/android\//.test(file))
    ? 'native'
    : null;
if (!kind) process.exit(0);
if (/(\.test|\.spec|\.stories)\.tsx$|__tests__|fixture|\/app\/dev-/i.test(file)) process.exit(0);
if (kind === 'native' && /Tests?[./]|\/test\/|\/androidTest\/|Mocks?[./]|\/Previews?\/|Previews?\.swift$|Fixtures?[./]|\/Debug\//.test(file)) process.exit(0);

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
  const seen = [];
  if (kind === 'tsx') {
    for (const m of code.matchAll(/>([^<>{}]+)</g)) {
      seen.push(m);
      out.push(m[1]);
    }
    for (const m of code.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.){12,})\1/g)) {
      seen.push(m);
      const before = code.slice(Math.max(0, m.index - 12), m.index);
      if (/className=\s*$|cn\(\s*$/.test(before)) continue;
      out.push(m[2]);
    }
  } else {
    // Swift and Kotlin: copy is inline string literals (Text("…"), Button("…"), """…""").
    // Log and assertion messages are not on screen.
    const logCall = /(print|NSLog|fatalError|assert\w*|precondition\w*|Log\.\w+|\.(debug|info|notice|error|warning|fault|log|trace))\((\s*"[^"]*"\s*,)?\s*$/;
    const literals = [...code.matchAll(/"""([\s\S]*?)"""/g), ...code.replace(/"""[\s\S]*?"""/g, (t) => ' '.repeat(t.length)).matchAll(/"((?:[^"\\\n]|\\.){12,})"/g)];
    for (const m of literals) {
      seen.push(m);
      const before = code.slice(Math.max(0, m.index - 30), m.index);
      if (m[0].startsWith('"""') || !logCall.test(before)) out.push(m[1]);
    }
  }
  // An edit inside a multi-line string or JSX paragraph carries no quotes or tags, so the
  // patterns above miss it; a leftover line of plain prose is that text.
  let rest = code;
  for (const m of seen) rest = rest.slice(0, m.index) + ' '.repeat(m[0].length) + rest.slice(m.index + m[0].length);
  for (const line of rest.split("\n").map((l) => l.replace(/\/\/.*$/, ""))) {
    if (!/["`=<>{};]|->|^\s*(case|let|var|val|func|fun|return|if|else|guard|const)\b/.test(line)) out.push(line);
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
