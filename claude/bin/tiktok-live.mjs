#!/usr/bin/env node
// Is each TikTok post live? Opens it logged out in the shared agent Chrome (its own throwaway
// browser context) and reads what TikTok shows a visitor. Prints one JSON line per post:
// {"url","state"} with state live | unavailable | private | account_gone | unknown.
//
// Why a browser: TikTok's oEmbed and /embed/v2 both answer 200 for any video id, even a made-up
// one, so neither can tell a live post from a gone one (checked 2026-11-11). Only the rendered
// page can. Every run first checks a made-up id as a control and stops if it does not read as
// unavailable, so a change on TikTok's side cannot make this script report false "live" answers.
//
// Usage: tiktok-live.mjs <tiktok post url>... (or one url per line on stdin)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CONTROL = 'https://www.tiktok.com/@nobodyhere_x9q/video/7123456789012345678';
const PACE_MS = 1500;

const browserUrl = execFileSync(`${process.env.HOME}/.claude/bin/agent-chrome.sh`, { encoding: 'utf8' }).trim();
const { webSocketDebuggerUrl } = await (await fetch(`${browserUrl}/json/version`)).json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true });
const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId, background: true });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);

async function check(url) {
  await send('Page.navigate', { url }, sessionId);
  for (let i = 0; i < 20; i++) {
    await sleep(750);
    const { result } = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const t = (document.body?.innerText || '').replace(/\\s+/g, ' ');
        if (/This account is private/.test(t)) return 'private';
        if (/Couldn.t find this account/.test(t)) return 'account_gone';
        if (/Video currently unavailable|This video is unavailable|Video not available/.test(t)) return 'unavailable';
        const v = document.querySelector('video');
        if (v && (v.currentSrc || v.src || v.querySelector('source'))) return 'live';
        return '';
      })()`,
    }, sessionId);
    if (result.value) return result.value;
  }
  return 'unknown';
}

const urls = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readFileSync(0, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
try {
  const control = await check(CONTROL);
  if (control !== 'unavailable') {
    console.error(`tiktok-live: the made-up control video read as "${control}", not "unavailable". TikTok's page changed, so no answer from this run can be trusted. Fix the markers in this script first.`);
    process.exit(2);
  }
  for (const url of urls) {
    await sleep(PACE_MS);
    console.log(JSON.stringify({ url, state: await check(url) }));
  }
} finally {
  await send('Target.closeTarget', { targetId }).catch(() => {});
  await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  ws.close();
}
