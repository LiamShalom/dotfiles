// UserPromptSubmit: close this chat's agent-Chrome tabs, which by the next prompt are stale previews.
// One tab stays, blanked, because closing a window's last tab ends the chat's browser context.
// Pages handed to Session Board's pane open in the chat's window too; they stay, as Liam is looking at them.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

let paneTabs = new Set();
try {
  const pane = JSON.parse(readFileSync(`${homedir()}/Library/Application Support/Session Board/pane.json`, 'utf8'));
  paneTabs = new Set((pane.tabs ?? []).map((t) => t.id));
} catch {
  // Without the pane's list a hand-off cannot be told apart, so touch nothing.
  process.exit(0);
}

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {}
const sid = input.session_id || process.env.CLAUDE_CODE_SESSION_ID;
let ctx;
try { ctx = readFileSync(`${homedir()}/.cache/agent-chrome/chats/${sid}`, 'utf8').trim(); } catch { process.exit(0); }
if (!ctx) process.exit(0);

const signal = AbortSignal.timeout(1500);
let version;
try { version = await fetch('http://127.0.0.1:9222/json/version', { signal }).then((r) => r.json()); } catch { process.exit(0); }

const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const done = () => { ws.close(); process.exit(0); };
setTimeout(done, 4000);
ws.onerror = done;
ws.onopen = async () => {
  const { result } = await send('Target.getTargets');
  const pages = (result?.targetInfos ?? []).filter((t) => t.type === 'page' && t.browserContextId === ctx && !paneTabs.has(t.targetId));
  if (pages.length === 0) return done();
  const [keep, ...rest] = pages;
  for (const t of rest) await send('Target.closeTarget', { targetId: t.targetId });
  if (keep.url !== 'about:blank') {
    const { result: s } = await send('Target.attachToTarget', { targetId: keep.targetId, flatten: true });
    const i = ++id;
    await new Promise((res) => { pending.set(i, res); ws.send(JSON.stringify({ id: i, sessionId: s.sessionId, method: 'Page.navigate', params: { url: 'about:blank' } })); });
  }
  done();
};
