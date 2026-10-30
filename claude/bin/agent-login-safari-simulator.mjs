// Import from cua_repl. Saved credentials remain inside the login tool.
import { LoginError, resolveLogin } from './agent-login-core.mjs';

class SimulatorLoginError extends Error {}
const clean = value => value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');

function inspect(state, windowName) {
  if (!state.startsWith(`Window: "${windowName}", App: Simulator.`)) {
    throw new SimulatorLoginError('The selected Simulator window changed; no credentials entered');
  }
  const address = state.match(/^\s*(\d+) (?:element|text field)[^\n]*Description: Address,[^\n]*/m);
  const value = address?.[0].match(/, Value: (.*?)(?=, (?:Placeholder|ID|Details|Secondary Actions):|$)/);
  if (!address || !value) throw new SimulatorLoginError('Safari address is unavailable; no credentials entered');
  return { id: Number(address[1]), value: clean(value[1]), editing: address[0].includes(', ID: URL') };
}

function assertOrigin(value, expected, full = false) {
  if (value.startsWith('https://')) {
    try { if (new URL(value).origin === expected.origin) return; } catch {}
  } else if (!full && value === expected.hostname) return;
  throw new SimulatorLoginError('Safari is not on the expected HTTPS origin; login stopped');
}

export async function loginInSimulator(app, mirror, {
  simulatorId, windowName, origin, field, point, item, account, emailCode = false,
} = {}, load = resolveLogin) {
  const expected = new URL(origin);
  const preview = new URL(await mirror.url());
  if (expected.protocol !== 'https:' || expected.href !== `${expected.origin}/`) {
    throw new SimulatorLoginError('An exact HTTPS origin is required');
  }
  if (!simulatorId || !windowName || !['http:', 'https:'].includes(preview.protocol)
    || !['localhost', '127.0.0.1'].includes(preview.hostname)
    || preview.searchParams.get('device') !== simulatorId) {
    throw new SimulatorLoginError('An explicit matching local simulator preview is required');
  }
  if (!['username', 'password', 'code'].includes(field)
    || !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) {
    throw new SimulatorLoginError('Supply one observed credential field and its preview coordinates');
  }
  const safari = mirror.playwright.getByText('com.apple.mobilesafari', { exact: true });
  if (!await safari.isVisible()) throw new SimulatorLoginError('The preview is not showing Safari');
  const state = () => app.getAXState({ emit: false, disableDiffing: true });
  let current = await state();
  let address = inspect(current, windowName);
  // Expand the real Safari address, rather than trusting a caller-provided URL.
  for (let i = 0; i < 2 && !address.value.startsWith('https://'); i++) {
    assertOrigin(address.value, expected);
    await app.click(address.id);
    current = await state();
    address = inspect(current, windowName);
  }
  assertOrigin(address.value, expected, true);
  const close = current.match(/^\s*(\d+) button[^\n]*ID: CancelBarItemButton/m);
  if (!close) throw new SimulatorLoginError('Safari address editor cannot be dismissed; no credentials entered');
  await app.click(Number(close[1]));
  const page = inspect(await state(), windowName);
  assertOrigin(page.value, expected);
  if (page.editing) throw new SimulatorLoginError('Safari address editor is still open; no credentials entered');

  let values;
  try {
    values = await load(`${expected.origin}/`, { user: field === 'username', pass: field === 'password', otp: field === 'code', split: 0 }, { item, account, emailCode });
  } catch (error) {
    if (error instanceof LoginError) throw error;
    throw new SimulatorLoginError('Saved login could not be loaded; no values returned');
  }
  try {
    if (!values[field]) return { origin: expected.origin, filled: [], missing: [field], submitted: false };
    assertOrigin(inspect(await state(), windowName).value, expected);
    await mirror.click(point);
    // Native typing returns before a long string has settled. Settle every character
    // without reading or emitting the filled field, and stop if the window changes.
    for (const character of values[field]) {
      assertOrigin(inspect(await state(), windowName).value, expected);
      await app.typeText(character);
    }
    assertOrigin(inspect(await state(), windowName).value, expected);
    return { origin: expected.origin, filled: [field], missing: [], submitted: false };
  } catch (error) {
    if (error instanceof SimulatorLoginError) throw error;
    throw new SimulatorLoginError('Native login stopped during input; inspect the page');
  } finally {
    values.username = values.password = values.code = '';
    if (values.mail) values.mail.code = '';
    values.item = undefined;
  }
}
