// Reuse the saved SideShift login on a preview that Vercel confirms belongs to this team.
import { execFileSync } from 'node:child_process';
import { loginInCodex } from './agent-login-codex.mjs';
import { resolveLogin } from './agent-login-core.mjs';

export async function loginSideShiftPreviewInCodex(tab, options, { run = execFileSync, load = resolveLogin } = {}) {
  const page = new URL(await tab.url());
  if (page.protocol !== 'https:' || !/^sideshift-[a-z0-9-]+-side-shift\.vercel\.app$/.test(page.hostname)) {
    throw new Error('This is not a SideShift preview host');
  }
  try {
    run('vercel', ['inspect', page.hostname, '--scope', 'side-shift'], {
      timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('Vercel could not confirm that this preview belongs to the side-shift team');
  }
  return loginInCodex(tab, options, (_href, before, opts) =>
    load('https://app.sideshift.app/signin', before, opts));
}
