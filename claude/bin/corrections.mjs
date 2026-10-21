#!/usr/bin/env node
// Pull the operator's correction turns out of recent transcripts, with the agent text they answered.
// Usage: corrections.mjs [days=7] [projects-dir=~/.claude/projects]
// Output is raw material for the `correct` skill: a person or model still has to judge each hit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const days = Number(process.argv[2] ?? 7);
const root = process.argv[3] ?? path.join(os.homedir(), '.claude/projects');
const since = Date.now() - days * 864e5;

const SIGNAL = new RegExp(
  [
    String.raw`^(no|nope|wrong|stop|wait)\b(?![ -](problem|worries|need|rush|thanks))`,
    String.raw`\b(i (said|told you|asked( you)?)|i already|as i said|like i said)\b`,
    String.raw`\b(still (not|broken|wrong|doesn'?t|isn'?t)|every time|(you|it) keeps? (doing|adding|making|forgetting|breaking)|(made|making) the same)\b`,
    String.raw`\b(why (did|are|would) you|you (forgot|missed|didn'?t|did not|ignored|broke|should have|shouldn'?t have))\b`,
    String.raw`\b(that'?s not (what|right|it)|not what i (asked|meant|wanted)|don'?t (ever|do that))\b`,
    String.raw`\b(never|always) (do|use|add|run|open|merge|ask|push)\b`,
    // The operator types fast and implicitly: "wdym", "still dont…", "this is in instructions".
    String.raw`\b(wdym|heads up|you already|no need to|doesn'?t actually|instead of)\b`,
    String.raw`\bstill (don'?t|doesn'?t|isn'?t|getting|seeing|appear|open|show|not)`,
    String.raw`\b(this|that|it)('?s| is) (in|already in) (the |my |your )?(instructions|claude|agents|rules|memory)`,
    String.raw`\bi (need|want) you to (ensure|make sure|always|never|stop)\b`,
    String.raw`\bkeeps? (appearing|happening|opening|showing|failing)\b`,
  ].join('|'),
  'i',
);
const NOISE =
  /^(<command-|<task-notification|<local-command|\[Request interrupted|Caveat:|This session is being continued|Continue the work from|Recompact compacted|Reply with|LIVECHECK|Call the |Do two tool calls)/;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'subagents' && e.name !== 'memory') yield* walk(p);
    } else if (e.name.endsWith('.jsonl')) yield p;
  }
}

const textOf = (c) =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
const clean = (s) =>
  s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/\s+/g, ' ').trim();

// Forked and recompacted sessions copy the same turns into many files.
const seen = new Set();
const hits = [];
for (const f of walk(root)) {
  if (fs.statSync(f).mtimeMs < since) continue;
  const project = path.basename(path.dirname(f)).replace(/^-Users-[^-]+-/, '');
  const sid = path.basename(f, '.jsonl').slice(0, 8);
  let lastAgent = '';
  const rl = readline.createInterface({ input: fs.createReadStream(f) });
  for await (const line of rl) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.isSidechain || o.isMeta) continue;
    const c = o?.message?.content;
    if (o.type === 'assistant') {
      const t = clean(textOf(c));
      if (t) lastAgent = t;
      continue;
    }
    if (o.type !== 'user' || Date.parse(o.timestamp) < since) continue;
    if (Array.isArray(c) && c.some((b) => b.type === 'tool_result')) continue;
    const t = clean(textOf(c));
    if (!t || NOISE.test(t) || !SIGNAL.test(t)) continue;
    const key = o.timestamp.slice(0, 16) + t;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ ts: o.timestamp, project, sid, user: t, agent: lastAgent });
  }
}

hits.sort((a, b) => a.ts.localeCompare(b.ts));
console.log(`# Correction candidates, last ${days} days: ${hits.length}\n`);
for (const h of hits) {
  console.log(`## ${h.ts.slice(0, 16)} · ${h.project} · ${h.sid}`);
  console.log(`- **agent said:** …${h.agent.slice(-280)}`);
  console.log(`- **operator:** ${h.user.slice(0, 600)}\n`);
}
