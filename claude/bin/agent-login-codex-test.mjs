// Import from cua_repl. Credentials travel from Keychain to the observed native form only.
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loginInCodex } from './agent-login-codex.mjs';

const ACCOUNT_KEYS = {
  brand: ['DEV_TESTING_LIAM_EMAIL', 'DEV_TESTING_LIAM_PASSWORD'],
  creator: ['SIDESHIFT_TEST_CREATOR_EMAIL', 'SIDESHIFT_TEST_CREATOR_PASSWORD'],
};

export async function loginSideShiftTestInCodex(tab, { role = 'brand', fields, submit = false } = {}, run = execFileSync) {
  if (!Object.hasOwn(ACCOUNT_KEYS, role)) throw new Error('Choose the brand or creator test account');
  if (!fields || Object.keys(fields).some(key => !['username', 'password'].includes(key))) {
    throw new Error('Supply username or password locators from the observed SideShift sign-in form');
  }
  const page = new URL(await tab.url());
  if (page.protocol !== 'https:') throw new Error('SideShift test login requires HTTPS');
  if (page.hostname !== 'app.sideshift.app') {
    if (!/^sideshift-[a-z0-9-]+-side-shift\.vercel\.app$/.test(page.hostname)) {
      throw new Error('This is not a SideShift production or preview host');
    }
    try {
      run('vercel', ['inspect', page.hostname, '--scope', 'side-shift'], {
        timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      throw new Error('Vercel could not confirm that this preview belongs to the side-shift team');
    }
  }
  return loginInCodex(tab, { fields, submit }, async () => {
    if (new URL(await tab.url()).origin !== page.origin) throw new Error('The sign-in page changed origin');
    const keys = ACCOUNT_KEYS[role];
    const script = 'const keys=JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify({username:process.env[keys[0]]||"",password:process.env[keys[1]]||""}))';
    try {
      const values = JSON.parse(run(join(homedir(), 'sideshift-monorepo', '.codex', 'with-test-secrets'),
        ['/opt/homebrew/bin/node', '-e', script, JSON.stringify(keys)],
        { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }));
      if (['username', 'password'].some(key => typeof values[key] !== 'string' || !values[key] || values[key].startsWith('op://'))) {
        throw new Error('Missing test credentials');
      }
      return values;
    } catch {
      throw new Error('The saved test account is unavailable through with-test-secrets');
    }
  });
}
