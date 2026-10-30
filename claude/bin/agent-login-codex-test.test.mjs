import test from 'node:test';
import assert from 'node:assert/strict';
import { loginSideShiftTestInCodex } from './agent-login-codex-test.mjs';

const origin = 'https://sideshift-example-side-shift.vercel.app';
function fixture(url = `${origin}/signin`) {
  const writes = [];
  return {
    tab: { url: async () => url },
    field: { evaluate: async () => new URL(url).origin, fill: async value => writes.push(value), press: async key => writes.push(key) },
    writes,
  };
}
test('verifies preview ownership before privately filling the brand test account', async () => {
  const b = fixture();
  const calls = [];
  const result = await loginSideShiftTestInCodex(b.tab, { fields: { password: b.field }, submit: true }, (command, args) => {
    calls.push([command, args]);
    if (command === 'vercel') return '';
    assert.ok(args.includes('["DEV_TESTING_LIAM_EMAIL","DEV_TESTING_LIAM_PASSWORD"]'));
    return JSON.stringify({ username: 'synthetic-email', password: 'synthetic-password' });
  });
  assert.equal(calls[0][0], 'vercel');
  assert.deepEqual(b.writes, ['synthetic-password', 'Enter']);
  assert.deepEqual(result, { origin, filled: ['password'], missing: [], submitted: true });
});
test('does not read credentials for an unrelated host', async () => {
  const b = fixture('https://sideshift-example-evil.vercel.app/signin');
  await assert.rejects(loginSideShiftTestInCodex(b.tab, { fields: { password: b.field } }, () => { assert.fail('must not run'); }), /not a SideShift/);
  assert.deepEqual(b.writes, []);
});
test('does not read credentials when Vercel refuses ownership verification', async () => {
  const b = fixture();
  const calls = [];
  await assert.rejects(loginSideShiftTestInCodex(b.tab, { fields: { password: b.field } }, command => {
    calls.push(command);
    throw new Error('refused');
  }), /could not confirm/);
  assert.deepEqual(calls, ['vercel']);
  assert.deepEqual(b.writes, []);
});
test('does not expose credential subprocess errors', async () => {
  const b = fixture('https://app.sideshift.app/signin');
  await assert.rejects(loginSideShiftTestInCodex(b.tab, { fields: { password: b.field } }, () => {
    throw new Error('synthetic-secret-in-subprocess-output');
  }), error => !error.message.includes('synthetic-secret') && /could not be loaded/.test(error.message));
  assert.deepEqual(b.writes, []);
});
test('refuses cross-origin fields before reading credentials', async () => {
  const b = fixture('https://app.sideshift.app/signin');
  b.field.evaluate = async () => 'https://evil.test';
  await assert.rejects(loginSideShiftTestInCodex(b.tab, { fields: { password: b.field } }, () => assert.fail('must not read credentials')), /origin/);
});
