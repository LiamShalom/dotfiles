import test from 'node:test';
import assert from 'node:assert/strict';
import { loginInSimulator } from './agent-login-safari-simulator.mjs';

const settings = { simulatorId: 'qa-device', windowName: 'onboarding-video', origin: 'https://accounts.google.com', field: 'password', point: [640, 289], item: 'Google', account: 'work@example.com' };
const snapshot = (windowName = settings.windowName, address = 'https://accounts.google.com/signin') => `Window: "${windowName}", App: Simulator.\n  7 text field (settable) Description: Address, Placeholder: Search or enter website, ID: URL, Secondary Actions: Cancel, Value: ${address}, Details: ${address}\n  17 button Description: Close, ID: CancelBarItemButton`;
function fixture(states = [snapshot()]) {
  const typed = [], clicked = [];
  let loaded = 0, observations = 0, editing = true;
  const app = { getAXState: async () => { const value = states[Math.min(observations++, states.length - 1)]; return editing ? value : value.replace(', ID: URL', ', ID: TabBarItemTitle'); }, click: async id => { if(id === 17) editing = false; }, typeText: async value => typed.push(value) };
  const mirror = { url: async () => 'http://localhost:3200/?device=qa-device', playwright: { getByText: () => ({ isVisible: async () => true }) }, click: async point => clicked.push(point) };
  const load = async () => { loaded++; return { username: 'test', password: 'fake-secret', code: '' }; };
  return { app, mirror, load, typed, clicked, loaded: () => loaded };
}
test('fills privately through native UI, one settled character at a time', async () => {
  const f = fixture();
  const result = await loginInSimulator(f.app, f.mirror, settings, f.load);
  assert.equal(f.typed.join(''), 'fake-secret');
  assert.deepEqual(f.clicked, [settings.point]);
  assert.deepEqual(result, { origin: settings.origin, filled: ['password'], missing: [], submitted: false });
});
test('refuses the real past mistake: another session owns the front simulator', async () => {
  const f = fixture([snapshot('iPhone 17 Pro')]);
  await assert.rejects(loginInSimulator(f.app, f.mirror, settings, f.load), /window changed/);
  assert.equal(f.loaded(), 0);
  assert.equal(f.typed.length, 0);
});
test('refuses another origin before retrieving credentials', async () => {
  const f = fixture([snapshot(settings.windowName, 'https://example.com')]);
  await assert.rejects(loginInSimulator(f.app, f.mirror, settings, f.load), /expected HTTPS origin/);
  assert.equal(f.loaded(), 0);
});
test('refuses a different simulator preview before retrieving credentials', async () => {
  const f = fixture();
  await assert.rejects(loginInSimulator(f.app, f.mirror, { ...settings, simulatorId: 'other' }, f.load), /matching local simulator/);
  assert.equal(f.loaded(), 0);
});
test('stops before typing when the selected window changes during fill', async () => {
  const f = fixture([snapshot(), snapshot(), snapshot(), snapshot('iPhone 17 Pro')]);
  await assert.rejects(loginInSimulator(f.app, f.mirror, settings, f.load), /window changed/);
  assert.equal(f.typed.length, 0);
});
test('does not expose an input error containing the secret', async () => {
  const f = fixture();
  f.app.typeText = async () => { throw new Error('fake-secret'); };
  await assert.rejects(loginInSimulator(f.app, f.mirror, settings, f.load), error => error.message === 'Native login stopped during input; inspect the page');
});
test('expands and verifies Safari Private Browsing address before loading a login', async () => {
  const capsule = snapshot(settings.windowName, 'accounts.google.com — Private');
  const f = fixture([capsule, snapshot(), capsule]);
  const result = await loginInSimulator(f.app, f.mirror, settings, f.load);
  assert.deepEqual(result.filled, ['password']);
  assert.equal(f.loaded(), 1);
});
test('private label does not allow a lookalike hostname', async () => {
  const f = fixture([snapshot(settings.windowName, 'accounts.google.com.example.org — Private')]);
  await assert.rejects(loginInSimulator(f.app, f.mirror, settings, f.load), /expected HTTPS origin/);
  assert.equal(f.loaded(), 0);
});
test('accepts the actual native accessibility private annotation', async () => {
  const capsule = snapshot(settings.windowName, '\u200eaccounts.google.com, private');
  const f = fixture([capsule, snapshot(), capsule]);
  const result = await loginInSimulator(f.app, f.mirror, settings, f.load);
  assert.deepEqual(result.filled, ['password']);
});
test('verifies the full URL when Safari hides the www prefix', async () => {
  const capsule = snapshot(settings.windowName, 'instagram.com, private');
  const f = fixture([capsule, snapshot(settings.windowName, 'https://www.instagram.com/accounts/emailsignup/'), capsule]);
  const result = await loginInSimulator(f.app, f.mirror, { ...settings, origin: 'https://www.instagram.com' }, f.load);
  assert.deepEqual(result.filled, ['password']);
});
