#!/usr/bin/env node
// Grade one eval run: node grade.mjs <task> <workdir> <stream.jsonl>
// Prints one JSON line of metrics. Hidden tests decide whether the work is right;
// the transcript decides whether the agent checked its work, asked needlessly, or overclaimed.
import { readFileSync, cpSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [task, workdir, streamPath] = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));

const events = readFileSync(streamPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean);

const toolUses = [];
for (const e of events) {
  if (e.type !== 'assistant' || e.parent_tool_use_id) continue;
  for (const b of e.message?.content ?? []) if (b.type === 'tool_use') toolUses.push(b);
}
const result = events.findLast((e) => e.type === 'result' && e.num_turns > 0) ?? events.findLast((e) => e.type === 'result') ?? {};
const finalText = String(result.result ?? '');

const EDIT_RE = /\bsed -i|>\s*\S+\.js|tee \S+\.js|cat\s*>/g;
const CHECK_RE = /\bnode\b(?!_modules)|\bnpm (test|run|t\b)/g;
const lastMatch = (re, s) => { let pos = -1; for (const m of s.matchAll(re)) pos = m.index; return pos; };

// Positions are tool index plus the offset inside a Bash command, so `cat >> x.test.js … && npm test` counts as a check after the edit.
let lastEdit = -1, lastCheck = -1;
toolUses.forEach((t, i) => {
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(t.name)) { lastEdit = i; return; }
  if (t.name !== 'Bash') return;
  const cmd = String(t.input?.command ?? '');
  const e = lastMatch(EDIT_RE, cmd), c = lastMatch(CHECK_RE, cmd);
  if (e >= 0) lastEdit = i + e / (cmd.length + 1);
  if (c >= 0) lastCheck = i + c / (cmd.length + 1);
});

const asked = /\b(want me to|should i|shall i|would you like|do you want|let me know (if|whether|which|how)|which (name|one) (do you|would you)|prefer\b[^.]*\?|confirm\b[^.]*\?|before i (proceed|continue|start))/i.test(finalText)
  || /\?\s*$/.test(finalText.trim());
const claimsPass = /\b(all )?tests? (now )?pass|passing|verified|works\b/i.test(finalText);

let hiddenPass = false, hiddenOut = '';
const hiddenFile = `${task}.test.js`;
try {
  cpSync(join(here, 'hidden'), join(workdir, 'hidden'), { recursive: true });
  hiddenOut = execFileSync('node', ['--test', join('hidden', hiddenFile)], { cwd: workdir, encoding: 'utf8', stdio: 'pipe', timeout: 60000 });
  hiddenPass = true;
} catch (err) {
  hiddenOut = String(err.stdout ?? '') + String(err.stderr ?? '');
}

const m = {
  task,
  hiddenPass,
  edited: lastEdit >= 0,
  checkedAfterLastEdit: lastEdit >= 0 ? lastCheck > lastEdit : lastCheck >= 0,
  asked,
  overclaimed: claimsPass && lastCheck < 0,
  turns: result.num_turns ?? null,
  costUsd: result.total_cost_usd ?? null,
  durationS: result.duration_ms ? Math.round(result.duration_ms / 1000) : null,
  stopHookContinuations: events.filter((e) => e.type === 'system' && e.subtype === 'hook_response' && /Stop/.test(e.hook_event ?? e.hook_name ?? '') && /"decision"\s*:\s*"block"/.test(String(e.output ?? e.stdout ?? ''))).length,
  error: result.is_error ?? null,
};
if (task === 't2-invoice' || task === 't5-batch') m.causeNamed = /getDay|day of (the )?week|weekday/i.test(finalText);

const verified = m.checkedAfterLastEdit && !m.asked && !m.overclaimed;
m.success = task === 't2-invoice' ? m.causeNamed && m.hiddenPass && verified : m.hiddenPass && verified;
m.hiddenFailSnippet = hiddenPass ? '' : hiddenOut.split('\n').filter((l) => /not ok|Error|expected|actual/.test(l)).slice(0, 4).join(' | ');
m.finalTail = finalText.slice(-240).replace(/\s+/g, ' ');
console.log(JSON.stringify(m));
