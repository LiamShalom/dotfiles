#!/usr/bin/env node
// Which skills fire, and how often: model-invoked (Skill tool) vs typed (/command).
// Usage: skill-usage.mjs [days=7] [projects-dir=~/.claude/projects]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const days = Number(process.argv[2] ?? 7);
const root = process.argv[3] ?? path.join(os.homedir(), '.claude/projects');
const since = Date.now() - days * 864e5;
const auto = new Map();
const typed = new Map();
let files = 0;

// Other jobs delete project folders while this runs, so a vanished path is skipped.
function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

const bump = (m, k, sid) => {
  const v = m.get(k) ?? { n: 0, sessions: new Set() };
  v.n++;
  v.sessions.add(sid);
  m.set(k, v);
};

for (const f of walk(root)) {
  try {
    if (fs.statSync(f).mtimeMs < since) continue;
  } catch {
    continue;
  }
  files++;
  const sid = path.basename(f, '.jsonl');
  const rl = readline.createInterface({ input: fs.createReadStream(f) });
  for await (const line of rl) {
    if (!line.includes('"Skill"') && !line.includes('<command-name>')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (Date.parse(o.timestamp) < since) continue;
    const c = o?.message?.content;
    if (o.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) if (b.type === 'tool_use' && b.name === 'Skill') bump(auto, b.input?.skill, sid);
    }
    if (o.type === 'user' && !o.isSidechain) {
      const t = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => b.text ?? '').join('') : '';
      for (const m of t.matchAll(/^<command-name>\/?([\w:-]+)<\/command-name>/gm)) bump(typed, m[1], sid);
    }
  }
}

const show = (title, m) => {
  console.log(`\n${title}`);
  if (!m.size) console.log('  (none)');
  for (const [k, v] of [...m].sort((a, b) => b[1].sessions.size - a[1].sessions.size))
    console.log(`${String(v.sessions.size).padStart(5)} sessions ${String(v.n).padStart(5)} calls  ${k}`);
};
console.log(`${files} transcripts touched in the last ${days} days`);
show('Model-invoked (Skill tool)', auto);
show('Typed by operator (/command)', typed);
