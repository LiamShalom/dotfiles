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
    const proof = path.join(home2, '.claude', 'jobs', 'j', 'tmp', 'proof');
    assert.equal(copyDestination('abs', `${proof.slice(1)}/shots/a.png`, { ...o, outputs: [proof] }), `${proof}/shots/a.png`, 'inside a folder the job created');
    assert.ok(fs.statSync(`${proof}/shots`).isDirectory());
    assert.equal(copyDestination('abs', `${proof.slice(1)}-x/a.png`, { ...o, outputs: [proof] }), null, 'a sibling of a named folder');
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

test('a sed address or regex that starts with / is not a path', () => {
  const r = plan(`node scripts/agent-preflight.mjs > ${home}/.claude/jobs/d/tmp/p.log 2>&1; sed -n '/summary/,$p' ${home}/.claude/jobs/d/tmp/p.log`);
  assert.equal(r.ok, true);
  assert.match(r.script, /sed -n '\/summary\/,\$p'/);
});

test('--base refs are reported so the mirror gets them', () => {
  assert.deepEqual(plan('node scripts/agent-preflight.mjs --base origin/feat/listing-boost-tiers > /tmp/p.log').refs, ['origin/feat/listing-boost-tiers']);
  assert.deepEqual(plan('node scripts/agent-preflight.mjs --base=main').refs, ['main']);
});

const mob = '/Users/liam/sideshift-mobile-wt-reconnect';
const iosPlan = (script) =>
  planJob(['/bin/zsh', '-c', script], { cwd: mob, root: mob, home, remote: { ...remote, dd: '/Users/s/hr/dd/k' }, stat, env: {}, pool: 'xcode' });
const UDID = 'D1B92C58-6B6F-4918-B2D2-4CA7469AF443';

test('an iOS simulator test maps its project, DerivedData, simulator and log', () => {
  const r = iosPlan(
    `cd ${mob} && xcodebuild -parallel-testing-enabled NO test -quiet -project SideShift.xcodeproj -scheme SideShiftTests -destination 'platform=iOS Simulator,id=${UDID}' -derivedDataPath ${home}/.cache/sideshift-reconnect-dd -only-testing:SideShiftTests/CreatorSocialOAuthTests CODE_SIGNING_ALLOWED=NO > ${home}/.cache/reconnect-test.log 2>&1; echo "exit $?" >> ${home}/.cache/reconnect-test.log`,
  );
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.sims, [UDID]);
  assert.match(r.script, /^cd \/Users\/s\/hr\/work\/k && xcodebuild/);
  assert.match(r.script, /-derivedDataPath \/Users\/s\/hr\/dd\/k -only-testing/);
  assert.deepEqual(r.outputs, [`${home}/.cache/reconnect-test.log`]);
  assert.deepEqual(r.caches, [[`${home}/.cache/sideshift-reconnect-dd`, '/Users/s/hr/dd/k']]);
});

test('an id-only destination with DEVELOPER_DIR runs on the Studio', () => {
  const r = iosPlan(
    `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild build-for-testing -quiet -project ${mob}/SideShift.xcodeproj -scheme SideShiftTests -destination id=${UDID} -derivedDataPath ${home}/.claude/jobs/abc/tmp/dd`,
  );
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.sims, [UDID]);
  assert.match(r.script, /^DEVELOPER_DIR=\/Applications\/Xcode\.app\/Contents\/Developer xcodebuild/);
  assert.match(r.script, /-project \/Users\/s\/hr\/work\/k\/SideShift\.xcodeproj/);
});

for (const [script, reason] of [
  [`xcodebuild test -scheme S -destination 'platform=iOS,id=00008110-001A2B3C4D5E801E'`, /iOS Simulator/],
  ['xcodebuild test -scheme S', /iOS Simulator/],
  [`xcodebuild test -scheme S -destination id=${UDID} -destination 'name=iPhone 17'`, /by name/],
  [`xcodebuild test -scheme S -destination 'platform=iOS Simulator,name=iPhone 17 Pro'`, /by name/],
  [`xcodebuild archive -scheme S -destination 'generic/platform=iOS'`, /archives/],
  [`xcrun simctl boot ${UDID}; xcodebuild test -scheme S -destination 'platform=iOS Simulator,id=${UDID}'`, /device/],
  ['npm test', /not an xcodebuild job/],
]) {
  test(`iOS stays local: ${script.slice(0, 60)}`, () => {
    const r = iosPlan(script);
    assert.equal(r.ok, false);
    assert.match(r.reason, reason);
  });
}

test('a Gradle test or screenshot record runs on the Studio with the same JDK and SDK and a shared Gradle home', () => {
  const r = planJob(
    [
      '/bin/zsh',
      '-c',
      `cd ${mob}/android && JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools GRADLE_USER_HOME=${home}/.claude/jobs/abc/tmp/gradle-home ./gradlew --continue :core:designsystem:recordRoborazziDebug --tests '*X*' > /tmp/rec.log 2>&1`,
    ],
    { cwd: mob, root: mob, home, remote: { ...remote, gradle: '/Users/s/hr/gradle-home' }, stat, env: {} },
  );
  assert.equal(r.ok, true, r.reason);
  assert.match(r.script, /^cd \/Users\/s\/hr\/work\/k\/android && JAVA_HOME=\/opt\/homebrew\/opt\/openjdk@21\/libexec/);
  assert.match(r.script, /ANDROID_HOME=\/opt\/homebrew\/share\/android-commandlinetools GRADLE_USER_HOME=\/Users\/s\/hr\/gradle-home \.\/gradlew/);
  assert.deepEqual(r.outputs, ['/tmp/rec.log']);
});

for (const script of [
  './gradlew :app:assembleDebug', './gradlew installDebug', 'cd android && ./gradlew connectedDebugAndroidTest', './gradlew :app:bundleRelease',
  './gradlew build', './gradlew :app:packageDebug', './gradlew :app:publishListing', 'gradlew -p android 2>&1 assembleDebug',
]) {
  test(`Gradle stays local: ${script}`, () => {
    const r = plan(script);
    assert.equal(r.ok, false);
    assert.match(r.reason, /app this Mac needs/);
  });
}

test('xcodebuild in the general pool stays local', () => {
  assert.equal(plan(`xcodebuild test -scheme S -destination 'platform=iOS Simulator,id=${UDID}'`).ok, false);
});

test('a DerivedData path followed by a shell separator stops at the separator', () => {
  const r = iosPlan(`xcodebuild test -scheme S -destination 'platform=iOS Simulator,id=${UDID}' -derivedDataPath ${home}/.cache/x-dd; echo done`);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.caches, [[`${home}/.cache/x-dd`, '/Users/s/hr/dd/k']]);
  assert.deepEqual(r.outputs, []);
});

test('a result bundle inside the worktree runs on the Studio and maps into its worktree', () => {
  const r = iosPlan(
    `xcodebuild test -quiet -project ${mob}/SideShift.xcodeproj -scheme SideShiftTests -destination id=${UDID} -derivedDataPath ${mob}/.build/DerivedData -resultBundlePath ${mob}/.build/agent/results/unit-20261123-221500.xcresult -parallel-testing-enabled NO -only-testing:SideShiftTests`,
  );
  assert.equal(r.ok, true, r.reason);
  assert.match(r.script, /-resultBundlePath \/Users\/s\/hr\/work\/k\/\.build\/agent\/results\/unit-20261123-221500\.xcresult/);
  assert.deepEqual(r.caches, [[`${mob}/.build/DerivedData`, '/Users/s/hr/dd/k']]);
});

test('the same simulator in two destinations is still one simulator', () => {
  const d = `-destination 'platform=iOS Simulator,id=${UDID}'`;
  const r = iosPlan(`xcodebuild build-for-testing -scheme S ${d} && xcodebuild test-without-building -scheme S ${d}`);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.sims, [UDID]);
});

for (const [script, reason] of [
  [`xcodebuild test -scheme S -destination 'platform=iOS Simulator,id=${UDID}' -derivedDataPath build/dd`, /relative build folder/],
  [`xcodebuild test -scheme S -destination 'platform=iOS Simulator,id=${UDID}' -allowProvisioningDeviceRegistration`, /signs/],
  [`xcodebuild test -scheme S -destination 'platform=iOS Simulator,id=${UDID}'; codesign -s X a.app`, /signs/],
  [`xcodebuild test -scheme S -destination id=${UDID} -resultBundlePath ${home}/.cache/r.xcresult`, /outside its worktree/],
]) {
  test(`iOS stays local: ${script.slice(-45)}`, () => {
    const r = iosPlan(script);
    assert.equal(r.ok, false);
    assert.match(r.reason, reason);
  });
}
