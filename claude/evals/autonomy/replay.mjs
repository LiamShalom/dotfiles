#!/usr/bin/env node
// Replay the finish judge on real past turn-ends from Claude Code transcripts.
// A turn-end whose next operator message is a nudge ("test it", "keep going", "go ahead", "why did you stop", ...)
// is a stop the judge should have caught; other turn-ends estimate how often it would send an agent back needlessly.
// usage: node replay.mjs <out-dir> [--days 10] [--per-group 15] [--project-dir <dir>]
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const out = args[0];
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const days = Number(opt('days', 10));
const perGroup = Number(opt('per-group', 15));
const projectDir = opt('project-dir', join(homedir(), '.claude/projects/-Users-liamshalom-sideshift-monorepo'));
mkdirSync(join(out, 'transcripts'), { recursive: true });

const NUDGE = /\b(you (didn'?t|did not|never|haven'?t) (test|run|check|verif|finish|do)|test it\b|did you (test|run|check|verify)|why did you stop|keep going|just do it|you can do (that|this|it)|do it yourself|don'?t ask|stop asking|you have (my )?(access|login|the login)|i told you|finish (it|the job|the task)|go ahead|yes,? (do|please|go)|continue\b|proceed\b)/i;
const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
const isRealUser = (e) => e.type === 'user' && !e.isMeta && (typeof e.message?.content === 'string'
  || (Array.isArray(e.message?.content) && e.message.content.some((b) => b.type === 'text') && !e.message.content.some((b) => b.type === 'tool_result')))
  && !/^\s*(<command-|<local-command|Stop hook feedback|<system-reminder>|<task-notification>|\[SYSTEM NOTIFICATION)/.test(textOf(e.message.content));

const cutoff = Date.now() - days * 86400000;
const files = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl')).map((f) => join(projectDir, f)).filter((f) => statSync(f).mtimeMs > cutoff);

const nudged = [], other = [];
for (const file of files) {
  let entries;
  try { entries = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { continue; }
  const userIdx = entries.map((e, i) => (isRealUser(e) ? i : -1)).filter((i) => i >= 0);
  for (let k = 1; k < userIdx.length; k++) {
    const j = userIdx[k], prev = userIdx[k - 1];
    const turn = entries.slice(prev + 1, j);
    const lastText = turn.filter((e) => e.type === 'assistant').map((e) => textOf(e.message?.content)).filter(Boolean).pop();
    const tools = turn.filter((e) => e.type === 'assistant' && Array.isArray(e.message?.content) && e.message.content.some((b) => b.type === 'tool_use')).length;
    if (!lastText || tools === 0 || /^API Error|^Please run \/login|recompact summary/.test(lastText)) continue;
    const next = textOf(entries[j].message.content);
    if (/^Continue the work from where you left off/.test(next)) continue;
    const item = { file, cut: j, next: next.slice(0, 200), final: lastText };
    (NUDGE.test(next.slice(0, 300)) && next.length < 600 ? nudged : other).push(item);
  }
}

// Deterministic sample: spread across the list.
const sample = (list, n) => list.length <= n ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);
const cases = [...sample(nudged, perGroup).map((c) => ({ ...c, group: 'nudged' })), ...sample(other, perGroup).map((c) => ({ ...c, group: 'other' }))];
console.error(`turn-ends: ${nudged.length} nudged, ${other.length} other; judging ${cases.length}`);

const hook = join(homedir(), '.claude/hooks/finish-judge.sh');
function judge(c, n) {
  const lines = readFileSync(c.file, 'utf8').split('\n').filter(Boolean).slice(0, c.cut);
  const path = join(out, 'transcripts', `case-${n}.jsonl`);
  writeFileSync(path, lines.join('\n') + '\n');
  const input = { session_id: `replay-${n}-${Date.now()}`, hook_event_name: 'Stop', transcript_path: path, stop_hook_active: false, last_assistant_message: c.final, background_tasks: [] };
  return new Promise((resolve) => {
    const p = spawn('bash', [hook], { env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'cli', FINISH_JUDGE_LOG: join(out, 'judge.jsonl') } });
    let stdout = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.on('close', () => {
      let reason = null;
      try { reason = JSON.parse(stdout).reason; } catch {}
      resolve({ n, group: c.group, verdict: reason ? 'continue' : 'stop', reason, next: c.next, final: c.final.slice(-400) });
    });
    p.stdin.end(JSON.stringify(input));
  });
}

const results = [];
for (let i = 0; i < cases.length; i += 4) {
  results.push(...(await Promise.all(cases.slice(i, i + 4).map((c, k) => judge(c, i + k)))));
}
writeFileSync(join(out, 'replay.json'), JSON.stringify(results, null, 2));
for (const g of ['nudged', 'other']) {
  const r = results.filter((x) => x.group === g);
  console.log(`${g}: judge sent back ${r.filter((x) => x.verdict === 'continue').length}/${r.length}`);
}
