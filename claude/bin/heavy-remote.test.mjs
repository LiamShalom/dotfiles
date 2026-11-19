// node --test claude/bin/heavy-remote.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyDestination, planJob } from './heavy-remote.mjs';

test('copy-back writes only where the job was meant to', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hr-copy-')));
  const wt = path.join(tmp, 'wt');
  const home2 = path.join(tmp, 'home');
  fs.mkdirSync(path.join(wt, '.git'), { recursive: true });
  fs.mkdirSync(path.join(home2, '.claude', 'jobs', 'j', 'tmp'), { recursive: true });
  fs.symlinkSync('/etc', path.join(wt, 'link-out'));
  fs.symlinkSync('/etc/hosts', path.join(wt, 'hosts-link'));
  const log = path.join(home2, '.claude', 'jobs', 'j', 'tmp', 'p.log');
  const o = { root: wt, outputs: [log], home: home2 };
  try {
    assert.equal(copyDestination('abs', log.slice(1), o), log);
    assert.equal(copyDestination('abs', 'Users/x/.zshrc', o), null, 'not a named output');
    assert.equal(copyDestination('abs', 'etc/hosts', { ...o, outputs: ['/etc/hosts'] }), null, 'outside the output roots');
    assert.equal(copyDestination('wd-changed', 'lib/a.ts', o), path.join(wt, 'lib/a.ts'));
    assert.equal(copyDestination('wd-changed', '.git/hooks/pre-commit', o), null);
    assert.equal(copyDestination('wd-changed', '.GIT/hooks/pre-commit', o), null);
    assert.equal(copyDestination('wd-changed', 'packages/x/.Git/config', o), null);
    assert.equal(copyDestination('wd-changed', '../escape.txt', o), null);
    assert.equal(copyDestination('wd-changed', 'link-out/passwd', o), null, 'through a symlink');
    assert.equal(copyDestination('wd-changed', 'hosts-link', o), null, 'onto a symlink');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const home = '/Users/liam';
const root = '/Users/liam/sideshift-monorepo/.claude/worktrees/fix-x';
const remote = { wd: '/Users/s/hr/work/k', out: '/Users/s/hr/out/j/abs', node: '/Users/s/hr/node24/bin' };
const files = { '/private/tmp/cfg.json': { isDirectory: () => false, isFile: () => true, size: 100 } };
const dirs = new Set(['/tmp/base-main', '/Users/liam/.claude/jobs/abc/tmp/main-check']);
const stat = (p) => (dirs.has(p) ? { isDirectory: () => true, isFile: () => false } : files[p] ?? null);
const plan = (script, cwd = root, env = {}) => planJob(["/bin/zsh", "-c", script], { cwd, root, home, remote, stat, env });

test('preflight with a log in the job tmp dir maps the log and keeps the rest', () => {
  const r = plan(
    `node scripts/agent-preflight.mjs > ${home}/.claude/jobs/ffbed8db/tmp/preflight.log 2>&1; echo "exit $?"; grep -E "FAIL" ${home}/.claude/jobs/ffbed8db/tmp/preflight.log | cut -c1-300 | head -15`,
  );
  assert.equal(r.ok, true);
  assert.equal(
    r.script,
    `node scripts/agent-preflight.mjs > ${remote.out}${home}/.claude/jobs/ffbed8db/tmp/preflight.log 2>&1; echo "exit $?"; grep -E "FAIL" ${remote.out}${home}/.claude/jobs/ffbed8db/tmp/preflight.log | cut -c1-300 | head -15`,
  );
  assert.deepEqual(r.outputs, [`${home}/.claude/jobs/ffbed8db/tmp/preflight.log`]);
  assert.deepEqual(r.uploads, []);
});

test('a plain argv is quoted into one script', () => {
  const r = planJob(['npm', 'run', 'typecheck:tests'], { cwd: root, root, home, remote, stat, env: {} });
  assert.equal(r.ok, true);
  assert.equal(r.script, 'npm run typecheck:tests');
});

test('worktree paths map to the remote worktree; cwd below root becomes subdir', () => {
  const r = plan(`cd ${root}/packages/data-repos && npx vitest run ${root}/packages/data-repos/src/x.test.ts`, `${root}/packages`);
  assert.equal(r.ok, true);
  assert.equal(r.script, `cd ${remote.wd}/packages/data-repos && npx vitest run ${remote.wd}/packages/data-repos/src/x.test.ts`);
  assert.equal(r.subdir, 'packages');
});

test('an input file in /tmp is uploaded and mapped', () => {
  const r = plan('node_modules/.bin/tsc -p /private/tmp/cfg.json');
  assert.equal(r.ok, true);
  assert.deepEqual(r.uploads, ['/private/tmp/cfg.json']);
  assert.equal(r.script, `node_modules/.bin/tsc -p ${remote.out}/private/tmp/cfg.json`);
});

test('system paths and redirects to /dev/null stay as they are', () => {
  const r = plan('/usr/bin/env node scripts/agent-preflight.mjs 2>/dev/null | /usr/bin/tail -3');
  assert.equal(r.ok, true);
  assert.equal(r.script, '/usr/bin/env node scripts/agent-preflight.mjs 2>/dev/null | /usr/bin/tail -3');
});

test('node@24 from Homebrew maps to the Studio node24', () => {
  const r = plan('/opt/homebrew/opt/node@24/bin/node scripts/agent-preflight.mjs');
  assert.equal(r.script, `${remote.node}/node scripts/agent-preflight.mjs`);
});

const local = [
  ['cd /tmp/base-main && npx vitest run a.test.ts', /local directory/],
  [`npx vitest run --root ${home}/.claude/jobs/abc/tmp/main-check x.test.ts`, /local directory/],
  ['cd /Users/liam/sideshift-monorepo && npm test', /only exists here/],
  ['cat ~/notes.txt; npm test', /~\//],
  ['npm test > $HOME/x.log', /HOME/],
  ['/Users/liam/sideshift-monorepo/.codex/with-test-secrets npm test', /secrets|only exists/],
  ['node scripts/x.mjs && gh pr view 1', /local tool/],
  ['npx playwright test', /device or browser/],
  ['npm ci && npm test', /installs/],
  ['curl -s http://localhost:3000/api', /local tool|local server/],
  ['npx next build', /server or build/],
  ['git fetch origin main && node scripts/agent-preflight.mjs', /git state/],
  ['/Users/liam/.claude/bin/heavy npm test', /nests heavy|only exists/],
  ['heavy npm test', /nests heavy/],
  ['/opt/homebrew/opt/node@24/bin/npm run build:packages', /builds files/],
  ['npm run build > /tmp/b.log 2>&1', /builds files/],
  ['node_modules/.bin/tsc -b packages/data-repos', /builds files/],
  ['npm run test:integration', /emulators or Postgres/],
  ['npm run -s test:local-pg -- x', /emulators or Postgres/],
  ['npm run test:firestore-rules', /emulators or Postgres/],
  ['npx tsx scripts/backfill-foo.ts --dry-run', /repo script/],
  ['node scripts/reconcile-x.mjs', /repo script/],
];

test('a variable from this shell keeps the job local; script-local ones do not', () => {
  const env = { CLAUDE_JOB_DIR: '/Users/liam/.claude/jobs/abc', TMPDIR: '/var/folders/x', PWD: root };
  assert.match(plan('echo hi > $CLAUDE_JOB_DIR/tmp/x.txt', root, env).reason, /CLAUDE_JOB_DIR/);
  assert.match(plan('npx vitest run > ${TMPDIR}/v.log', root, env).reason, /TMPDIR/);
  assert.equal(plan('for f in a b; do echo $f; done; echo $PWD; echo "rc $?"', root, env).ok, true);
});

test('allowlisted variables are exported to the Studio', () => {
  const r = plan('npx vitest run a.test.ts', root, { CLAUDECODE: '1', SECRET_TOKEN: 'x' });
  assert.equal(r.script, "export CLAUDECODE='1'; npx vitest run a.test.ts");
  assert.equal(plan('echo $CLAUDECODE', root, { CLAUDECODE: '1' }).ok, true);
});

test('the preflight and ci scripts still run remotely', () => {
  assert.equal(plan('node scripts/agent-preflight.mjs --all').ok, true);
  assert.equal(plan('npx tsx scripts/ci/check-hot-table-ddl.ts').ok, true);
});

test('a file name that contains "heavy" is not the heavy command', () => {
  assert.equal(plan('cat heavy-remote-probe.txt; npm test').ok, true);
});
for (const [script, reason] of local) {
  test(`stays local: ${script}`, () => {
    const r = plan(script);
    assert.equal(r.ok, false);
    assert.match(r.reason, reason);
  });
}

test('a job whose cwd is outside its worktree stays local', () => {
  const r = plan('npm test', '/Users/liam');
  assert.equal(r.ok, false);
});

test('regex and sed text with slashes after a quote are not paths', () => {
  const r = plan(`npx vitest run a.test.ts 2>&1 | sed 's/\\x1b\\[[0-9;]*m//g' | grep -E "Test Files|×" | head`);
  assert.equal(r.ok, true);
});

test('pathRewriter maps Studio paths back, across chunk boundaries', async () => {
  const { pathRewriter } = await import('./heavy-remote.mjs');
  let got = '';
  const w = pathRewriter([[remote.out, ''], [remote.wd, root]], (s) => (got += s));
  const text = `${remote.wd}/lib/a.ts\n  12:3  error  x\nlog at ${remote.out}/private/tmp/x.log\npartial ${remote.wd}`;
  for (let i = 0; i < text.length; i += 7) w.write(Buffer.from(text.slice(i, i + 7)));
  w.flush();
  assert.equal(got, `${root}/lib/a.ts\n  12:3  error  x\nlog at /private/tmp/x.log\npartial ${root}`);
});

test('a code comment or URL in the script is not a path', () => {
  assert.equal(plan('echo "// note" >> lib/a.ts; grep -c "https://example.com/x" lib/a.ts').ok, true);
});
