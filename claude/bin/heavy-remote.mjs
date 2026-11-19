#!/usr/bin/env node
// heavy-remote.mjs — run one queued heavy job on the Mac Studio instead of
// waiting for a MacBook slot. bin/heavy calls it while every local slot is busy
// (pool `slot` only); the agent sees the same output, exit code and files.
//
//   node heavy-remote.mjs --started F --queued F --skip F --max-secs N -- <command...>
//
// The job ran remotely only when F(--started) exists afterwards; then the exit
// code is the job's. Otherwise nothing ran and heavy keeps waiting locally.
// --skip is written when this job can never run remotely (a local-only path,
// secrets, devices), so heavy stops asking.
//
// Steps: plan (pure, see planJob) → probe the Studio → push the commit to its
// mirror → stream uncommitted files + inputs → run under a remote slot → copy
// back the files the job wrote. The Studio side is heavy-remote-helper.sh.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const HERE = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
const HELPER = path.join(HERE, 'heavy-remote-helper.sh');
const NODE_VERSION = 'v24.22.1'; // the Studio's ~/heavy-remote/node24
const START_MARK = '\x01HEAVY-REMOTE-START';
const LOG = path.join(HOME, '.claude', 'logs', 'heavy-remote.log');
const MAX_UPLOAD = 200 * 1024 * 1024;
// A job's install, checkout and builds take about 5 GB; the floor keeps the
// Studio's own user from running out of disk.
const MIN_DISK_GB = Number(process.env.HEAVY_REMOTE_MIN_DISK_GB || 10);

const SHELLS = new Set(['/bin/zsh', '/bin/bash', '/bin/sh', 'zsh', 'bash', 'sh']);
// Anything that needs this Mac, its secrets or an outside account stays local.
const LOCAL_ONLY = [
  [/(^|[^\w/.-])~\//, 'uses ~/'],
  [/\$\{?HOME\b/, 'uses $HOME'],
  [/\.env\b/, 'reads env files'],
  [/with-test-secrets|\bop\s+(run|read|inject)\b/, 'uses secrets'],
  [/\b(vercel|gcloud|firebase|cloud-sql-proxy|psql|docker|colima|gh|ssh|scp|rsync|curl|wget|open)\b/, 'uses a local tool or account'],
  [/\bgit\s+(push|pull|fetch|worktree|stash|checkout|switch|reset|commit|merge|rebase)\b/, 'changes git state'],
  [/\b(xcodebuild|simctl|adb|emulator|playwright)\b/, 'needs a device or browser'],
  [/\bnext\s+(dev|build|start)\b|\bnpm\s+(run\s+)?(dev|start)\b/, 'starts a server or build'],
  [/\bnpm\s+(ci|install|i|add|uninstall|update)\b|sideshift-setup/, 'installs packages'],
  // Build output is git-ignored, so it would stay on the Studio; the job exists to make it here.
  [/\bbuild:packages\b|\bnpm\s+run\s+(-s\s+)?build\b|\btsup\b|\btsc\b[^|;&]*\s(-b|--build)\b/, 'builds files this Mac needs'],
  [/localhost|127\.0\.0\.1|0\.0\.0\.0/, 'talks to a local server'],
  // Firebase emulators, the local Postgres, and repo scripts (backfills,
  // reconciles) that read secrets. The preflight and CI checks are fine.
  [/\bnpm\s+(run\s+)?(-s\s+)?test:(integration|repos|local-pg|e2e|firestore|storage|[\w-]*rules)/, 'needs local emulators or Postgres'],
  [/\b(tsx|ts-node|node|bun)\s+(\.\/)?scripts\/(?!agent-preflight\.mjs\b|ci\/)/, 'runs a repo script that may need secrets'],
  [/(^|[\s;&|(/])heavy(\s|$)/, 'nests heavy'],
];
// Passed to the Studio so tools format output as they do here (vitest reads
// CLAUDECODE). Any other variable of this shell that the job names keeps it local.
export const ENV_PASS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'AI_AGENT', 'CODEX_SANDBOX', 'CI', 'TZ', 'NO_COLOR', 'FORCE_COLOR', 'TERM', 'COLUMNS', 'LANG', 'LC_ALL'];
const SHELL_VARS = new Set(['PWD', 'OLDPWD', 'SHLVL', '_']);
const SYSTEM_PATHS = ['/bin/', '/usr/bin/', '/usr/sbin/', '/sbin/', '/dev/null', '/dev/stdout', '/dev/stderr', '/dev/fd/'];
const NODE24 = '/opt/homebrew/opt/node@24/bin/';
// An absolute path token: starts after a shell separator, quote, = or redirect.
const PATH_TOKEN = /(?<=^|[\s'"=<>(:,;|&])\/[^\s'"`;|&<>(),]*/g;

export const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * Decide whether a job can run on the Studio and rewrite its paths.
 * root: the job's git worktree; home: this Mac's home; remote: {wd, out, node}
 * absolute Studio paths. Returns {ok:false, reason} or
 * {ok:true, script, subdir, outputs: [local paths], uploads: [local files]}.
 * `stat` is injectable for tests.
 */
export function planJob(argv, { cwd, root, home, remote, stat = statOrNull, env = process.env }) {
  let script;
  if (argv.length === 3 && SHELLS.has(argv[0]) && argv[1] === '-c') script = argv[2];
  else if (SHELLS.has(argv[0])) return { ok: false, reason: 'unusual shell invocation' };
  else script = argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : shq(a))).join(' ');

  const subdir = path.relative(root, cwd);
  if (subdir.startsWith('..') || path.isAbsolute(subdir)) return { ok: false, reason: 'runs outside its worktree' };
  for (const [re, reason] of LOCAL_ONLY) if (re.test(script)) return { ok: false, reason };
  for (const [, name] of script.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (env[name] !== undefined && !ENV_PASS.includes(name) && !SHELL_VARS.has(name)) {
      return { ok: false, reason: `uses $${name} from this Mac's environment` };
    }
  }

  const outRoots = [path.join(home, '.claude', 'jobs') + '/', '/tmp/', '/private/tmp/'];
  const outputs = new Set();
  const uploads = new Set();
  let reason = null;
  const rewritten = script.replace(PATH_TOKEN, (p) => {
    // `//` starts a URL's host (https://x) or a code comment, not a path.
    if (reason || p.startsWith('//')) return p;
    const clean = p.length > 1 ? p.replace(/\/+$/, '') : p;
    if (clean === root || clean.startsWith(root + '/')) return remote.wd + clean.slice(root.length);
    if (p.startsWith(NODE24)) return remote.node + '/' + p.slice(NODE24.length);
    if (SYSTEM_PATHS.some((s) => p === s.replace(/\/$/, '') || p.startsWith(s))) return p;
    if (outRoots.some((r) => clean.startsWith(r))) {
      const st = stat(clean);
      if (st?.isDirectory()) {
        reason = `names a local directory (${clean})`;
        return p;
      }
      if (st?.isFile()) {
        if (st.size > 5 * 1024 * 1024) {
          reason = `reads a large local file (${clean})`;
          return p;
        }
        uploads.add(clean);
      }
      outputs.add(clean);
      return remote.out + clean;
    }
    reason = `names a path that only exists here (${clean})`;
    return p;
  });
  if (reason) return { ok: false, reason };
  const exports = ENV_PASS.filter((k) => env[k] !== undefined).map((k) => `export ${k}=${shq(env[k])}`);
  return {
    ok: true,
    script: exports.length ? `${exports.join('; ')}; ${rewritten}` : rewritten,
    subdir,
    outputs: [...outputs],
    uploads: [...uploads],
  };
}

/**
 * Rewrite path prefixes in a byte stream. Whole lines are rewritten as they
 * arrive; a partial line (a progress bar) is written after 200 ms, so output
 * never stalls behind a missing newline.
 */
export function pathRewriter(pairs, emit) {
  let held = '';
  let timer = null;
  const decoder = new TextDecoder();
  const rewrite = (s) => pairs.reduce((acc, [from, to]) => acc.split(from).join(to), s);
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if (held) emit(rewrite(held));
    held = '';
  };
  return {
    write(buf) {
      held += decoder.decode(buf, { stream: true });
      const nl = held.lastIndexOf('\n');
      if (nl >= 0) {
        emit(rewrite(held.slice(0, nl + 1)));
        held = held.slice(nl + 1);
      }
      clearTimeout(timer);
      timer = held ? setTimeout(flush, 200) : null;
    },
    flush,
  };
}

/**
 * Where a file the Studio sent back may be written on this Mac, or null.
 * abs/<path>: only an output path the job's command named, in a folder that
 * really is under /tmp or ~/.claude/jobs. wd-changed/<path>: inside the
 * worktree, never under .git, never through a symlink. Creates the parent
 * folders inside the worktree unless mkdir is false.
 */
export function copyDestination(kind, rel, { root, outputs, home, mkdir = true }) {
  const lst = (p) => {
    try {
      return fs.lstatSync(p);
    } catch {
      return null;
    }
  };
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return null;
    }
  };
  if (path.isAbsolute(rel) || rel.split('/').includes('..')) return null;
  if (kind === 'abs') {
    const to = '/' + rel;
    if (!outputs.includes(to)) return null;
    const parent = real(path.dirname(to));
    const roots = ['/private/tmp', real(path.join(home, '.claude', 'jobs'))].filter(Boolean);
    if (!parent || !roots.some((r) => parent === r || parent.startsWith(r + '/'))) return null;
    if (lst(to)?.isSymbolicLink()) return null;
    return to;
  }
  if (kind !== 'wd-changed' || rel.split('/')[0] === '.git') return null;
  const realRoot = real(root);
  const to = path.join(root, rel);
  // The deepest folder that exists must resolve inside the worktree.
  let existing = path.dirname(to);
  while (!lst(existing)) existing = path.dirname(existing);
  const r = real(existing);
  if (!realRoot || !r || (r !== realRoot && !r.startsWith(realRoot + '/'))) return null;
  if (lst(to)?.isSymbolicLink()) return null;
  if (mkdir) fs.mkdirSync(path.dirname(to), { recursive: true });
  return to;
}

function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function log(line) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${process.pid} ${line}\n`);
  } catch {}
}

function connection() {
  const file = path.join(HOME, '.config', 'sideshift-pool', 'connection');
  const vars = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) vars[m[1]] = m[2].trim();
  }
  return {
    host: process.env.HEAVY_REMOTE_HOST || vars.POOL_HOST,
    user: vars.POOL_USER,
    identity: vars.POOL_IDENTITY,
    knownHosts: vars.POOL_KNOWN_HOSTS,
  };
}

function sshOptions(c, { shared = true } = {}) {
  fs.mkdirSync(path.join(HOME, '.ssh'), { recursive: true });
  return [
    '-i', c.identity, '-o', 'IdentitiesOnly=yes', '-o', 'UseKeychain=yes', '-o', 'BatchMode=yes',
    '-o', `UserKnownHostsFile=${c.knownHosts}`, '-o', 'ConnectTimeout=4',
    // The job itself runs on a connection of its own: when this side dies, even
    // by SIGKILL, the Studio's session ends and the helper stops the job.
    ...(shared ? ['-o', 'ControlMaster=auto', '-o', `ControlPath=${HOME}/.ssh/cm-heavy-%C`, '-o', 'ControlPersist=600'] : ['-o', 'ControlMaster=no', '-o', 'ControlPath=none']),
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
  ];
}

const sha256 = (...parts) => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
};

function git(root, args, opts = {}) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: opts.encoding ?? 'utf8', maxBuffer: 256 * 1024 * 1024, env: opts.env ?? process.env });
  return r.status === 0 ? r.stdout : null;
}

function parseArgs(argv) {
  const opts = {};
  let i = 0;
  for (; i < argv.length; i++) {
    if (argv[i] === '--') break;
    opts[argv[i].replace(/^--/, '')] = argv[++i];
  }
  return { opts, command: argv.slice(i + 1) };
}

async function main() {
  const { opts, command } = parseArgs(process.argv.slice(2));
  const started = Date.now();
  const skip = (reason) => {
    log(`local: ${reason} :: ${command.join(' ').slice(0, 200)}`);
    if (opts.skip) fs.writeFileSync(opts.skip, reason + '\n');
    return 0;
  };
  if (process.env.HEAVY_REMOTE === '0' || !command.length) return skip('disabled');

  const cwd = fs.realpathSync(process.cwd());
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top) return skip('not in a git checkout');
  const root = fs.realpathSync(top.trim());
  if (!/sideshift-monorepo/.test(git(root, ['config', 'remote.origin.url']) ?? '')) return skip('not a sideshift-monorepo checkout');

  const c = connection();
  const job = `${Date.now()}-${process.pid}`;
  const key = `${path.basename(root).replace(/[^\w.-]/g, '_').slice(0, 40)}-${sha256(root).slice(0, 8)}`;
  const rhome = `/Users/${c.user}/heavy-remote`;
  const remote = { wd: `${rhome}/work/${key}`, out: `${rhome}/out/${job}/abs`, node: `${rhome}/node24/bin` };
  const plan = planJob(command, { cwd, root, home: HOME, remote });
  if (!plan.ok) return skip(plan.reason);

  const read = (f) => statOrNull(path.join(root, f)) ? fs.readFileSync(path.join(root, f)) : Buffer.alloc(0);
  const depkey = sha256(read('package-lock.json'), read('.npmrc'), NODE_VERSION).slice(0, 20);
  const ssh = sshOptions(c);
  const target = `${c.user}@${c.host}`;
  const helperHash = sha256(fs.readFileSync(HELPER)).slice(0, 12);
  const helper = `${rhome}/bin/helper-${helperHash}.sh`;
  const remoteCall = (args, input) =>
    spawnSync('ssh', [...ssh, target, args], { input, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });

  // 1. Probe: is the Studio up, with a free slot, disk and memory?
  let probe = remoteCall(`${helper} probe ${depkey}`);
  if (probe.status === 127 || /No such file/.test(probe.stderr ?? '')) {
    const up = remoteCall(`mkdir -p ${rhome}/bin && cat > ${helper}.tmp && chmod +x ${helper}.tmp && mv ${helper}.tmp ${helper}`, fs.readFileSync(HELPER));
    if (up.status !== 0) return log(`busy: helper upload failed: ${up.stderr?.trim()}`), 0;
    probe = remoteCall(`${helper} probe ${depkey}`);
  }
  if (probe.status !== 0) return log(`busy: studio unreachable (${(probe.stderr || '').trim().split('\n').pop()})`), 0;
  const p = Object.fromEntries(probe.stdout.trim().split(/\s+/).map((kv) => kv.split('=')));
  if (Number(p.slots) < 1) return log('busy: no free studio slot'), 0;
  if (Number(p.disk_gb) < MIN_DISK_GB) return log(`busy: studio disk ${p.disk_gb} GB`), 0;
  if (Number(p.mem) < 15) return log(`busy: studio memory ${p.mem}%`), 0;
  if (p.install === 'building') return log('busy: studio install building'), 0;

  const tProbe = Date.now();
  // 2. Code: push HEAD (and origin/main, the preflight's base) to the mirror.
  const sha = git(root, ['rev-parse', 'HEAD'])?.trim();
  if (!sha) return skip('no HEAD commit');
  const sshCmd = ['ssh', ...ssh].map(shq).join(' ');
  const refspecs = [`+${sha}:refs/heavy/${key}`];
  if (git(root, ['rev-parse', '-q', '--verify', 'refs/remotes/origin/main'])) refspecs.push('+refs/remotes/origin/main:refs/remotes/origin/main');
  const push = spawnSync('git', ['-C', root, 'push', '-q', '--no-verify', `${target}:heavy-remote/mirror.git`, ...refspecs], {
    encoding: 'utf8',
    env: { ...process.env, GIT_SSH_COMMAND: sshCmd },
    timeout: 300_000,
  });
  if (push.status !== 0) return log(`busy: push failed: ${(push.stderr || '').trim().split('\n').pop()}`), 0;

  const tPush = Date.now();
  // 3. Stage uncommitted files (wd/), deletions and input files (abs/) as APFS clones.
  const z = (args) => (git(root, args) ?? '').split('\0').filter(Boolean);
  const changed = new Set([...z(['diff', '--name-only', '-z', 'HEAD']), ...z(['ls-files', '-o', '--exclude-standard', '-z'])]);
  const deleted = z(['diff', '--name-only', '-z', '--diff-filter=D', 'HEAD']);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'heavy-remote-'));
  const cleanup = () => fs.rmSync(stage, { recursive: true, force: true });
  let bytes = 0;
  const put = (src, dest) => {
    const st = fs.lstatSync(src);
    bytes += st.size;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dest);
    else fs.copyFileSync(src, dest, fs.constants.COPYFILE_FICLONE);
  };
  try {
    for (const f of changed) {
      const src = path.join(root, f);
      const st = statOrNull(src);
      if (st && !st.isDirectory()) put(src, path.join(stage, 'wd', f));
    }
    if (deleted.length) fs.writeFileSync(path.join(stage, 'wd.deleted'), deleted.join('\n') + '\n');
    for (const f of plan.uploads) put(f, path.join(stage, 'abs', f));
    // Only where the folder exists here: a missing folder must fail there too.
    for (const f of plan.outputs) {
      if (statOrNull(path.dirname(f))?.isDirectory()) fs.mkdirSync(path.join(stage, 'abs', path.dirname(f)), { recursive: true });
    }
  } catch (e) {
    cleanup();
    return skip(`could not stage files: ${e.message}`);
  }
  if (bytes > MAX_UPLOAD) {
    cleanup();
    return skip(`uncommitted files total ${Math.round(bytes / 1e6)} MB`);
  }

  const tStage = Date.now();
  // 4. Run. stdout streams straight through; stderr is held until the start
  // mark, so a job that never starts leaves no trace in the agent's output.
  const maxSecs = Number(opts['max-secs'] || 2700);
  const remoteCmd = `HEAVY_REMOTE_SUBDIR=${shq(plan.subdir || '.')} ${helper} run ${key} ${sha} ${depkey} ${job} ${maxSecs} ${shq(plan.script)}`;
  const tar = spawn('tar', ['-cf', '-', '-C', stage, '.'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const child = spawn('ssh', [...sshOptions(c, { shared: false }), target, remoteCmd], { stdio: ['pipe', 'pipe', 'pipe'] });
  tar.stdout.pipe(child.stdin);
  child.stdin.on('error', () => {});
  // Studio paths in the output (ESLint, tsc, pwd) read as this Mac's paths.
  const pairs = [[remote.out, ''], [remote.wd, root]];
  const out = pathRewriter(pairs, (s) => process.stdout.write(s));
  const err = pathRewriter(pairs, (s) => process.stderr.write(s));
  child.stdout.on('data', (buf) => out.write(buf));
  let seen = false;
  let pre = '';
  child.stderr.on('data', (buf) => {
    if (seen) return void err.write(buf);
    pre += buf.toString('utf8');
    const i = pre.indexOf(START_MARK);
    if (i < 0) return;
    seen = true;
    fs.writeFileSync(opts.started, '');
    // As a local slot does: the job no longer waits, and a pinned job no longer
    // holds other sessions' jobs back.
    if (opts.queued) fs.rmSync(opts.queued, { force: true });
    if (opts.pinwait) fs.rmSync(opts.pinwait, { force: true });
    const secs = (a, b) => ((b - a) / 1000).toFixed(1);
    const studio = pre.match(/heavy-remote: timing (.*)/)?.[1] ?? '';
    log(`remote: started ${key} after ${secs(started, Date.now())}s (probe ${secs(started, tProbe)}s, push ${secs(tProbe, tPush)}s, stage ${secs(tPush, tStage)}s, studio ${studio}) :: ${command.join(' ').slice(0, 200)}`);
    const rest = pre.slice(i + START_MARK.length).replace(/^\n/, '');
    if (rest) err.write(Buffer.from(rest));
  });
  let cancelled = null;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      cancelled = sig;
      // Before the start mark arrives the job may already run; killing the
      // connection stops it there as well (the helper watches its session).
      if (seen) remoteCall(`${helper} kill ${key}`);
      child.kill('SIGTERM');
    });
  }
  const [code, signal] = await new Promise((resolve) => child.on('close', (c2, s) => resolve([c2, s])));
  out.flush();
  err.flush();
  cleanup();
  if (!seen) {
    log(`busy: not started (${pre.trim().split('\n').filter((l) => l.startsWith('heavy-remote:')).pop() ?? `exit ${code}`})`);
    return cancelled ? 130 : 0;
  }
  let rc = code ?? 128 + (os.constants.signals[signal] ?? 15);
  if (cancelled) rc = cancelled === 'SIGINT' ? 130 : 143;

  // 5. Copy back what the job wrote: /tmp and ~/.claude/jobs outputs, worktree
  // files (snapshots, --fix, coverage/) and worktree deletions. A failure here
  // is reported but keeps the job's own exit code.
  const back = fs.mkdtempSync(path.join(os.tmpdir(), 'heavy-remote-back-'));
  let copied = 0;
  try {
    rc = copyBack();
  } catch (e) {
    process.stderr.write(`heavy: could not copy the job's output files back from the Mac Studio (${e.message})\n`);
    if (rc === 0) rc = 1;
  }
  fs.rmSync(back, { recursive: true, force: true });
  log(`remote: finished ${key} rc=${rc} in ${((Date.now() - started) / 1000).toFixed(1)}s, ${copied} files back`);
  return rc;

  function copyBack() {
  const collected = spawnSync('sh', ['-c', `ssh ${ssh.map(shq).join(' ')} ${shq(target)} ${shq(`${helper} collect ${job}`)} | tar -xf - -C ${shq(back)}`], { timeout: 300_000 });
  if (collected.status !== 0) throw new Error(`collect exited ${collected.status}`);
  // ssh exits 255 for a lost connection and for a job that exited 255; the
  // helper's .rc tells them apart.
  const jobRc = statOrNull(path.join(back, '.rc')) ? Number(fs.readFileSync(path.join(back, '.rc'), 'utf8').trim()) : null;
  if (!cancelled) {
    if (Number.isInteger(jobRc)) rc = jobRc;
    else if (code === 255) process.stderr.write('heavy: lost the connection to the Mac Studio while the job ran\n');
  }
  const walk = (dir, fn) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, fn);
      else if (e.isFile()) fn(full);
    }
  };
  for (const kind of ['abs', 'wd-changed']) {
    const base = path.join(back, kind);
    if (!fs.existsSync(base)) continue;
    walk(base, (f) => {
      // The Studio is a shared machine: write only where this job was meant to.
      const to = copyDestination(kind, path.relative(base, f), { root, outputs: plan.outputs, home: HOME });
      if (!to) return void log(`refused copy-back of ${kind}/${path.relative(base, f)}`);
      const data = fs.readFileSync(f);
      // Text files (logs, reports) get this Mac's paths, like the live output.
      const text =
        data.length < 64 * 1024 * 1024 && !data.subarray(0, 8192).includes(0) && pairs.some(([from]) => data.includes(from));
      if (text) {
        let rewritten = '';
        const w = pathRewriter(pairs, (s) => (rewritten += s));
        w.write(data);
        w.flush();
        fs.writeFileSync(to, rewritten);
      } else fs.writeFileSync(to, data);
      copied++;
    });
  }
  const deletedFile = path.join(back, 'wd-deleted');
  if (statOrNull(deletedFile)) {
    for (const f of fs.readFileSync(deletedFile, 'utf8').split('\0').filter(Boolean)) {
      const target2 = copyDestination('wd-changed', f, { root, outputs: [], home: HOME, mkdir: false });
      if (target2) fs.rmSync(target2, { force: true });
    }
  }
  return rc;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts0 = parseArgs(process.argv.slice(2)).opts;
  main().then(
    // Exit only after piped output has drained, or its tail is lost.
    (rc) => process.stdout.write('', () => process.stderr.write('', () => process.exit(rc ?? 0))),
    (e) => {
      log(`error: ${e.stack || e}`);
      // Before the start nothing ran and heavy queues locally; after it, the
      // job's result is unknown, which must not read as success.
      const ranRemotely = opts0.started && statOrNull(opts0.started);
      if (ranRemotely) process.stderr.write(`heavy: the Mac Studio run failed: ${e.message}\n`);
      process.exit(ranRemotely ? 1 : 0);
    },
  );
}
