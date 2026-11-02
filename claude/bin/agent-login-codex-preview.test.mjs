import test from 'node:test';
import assert from 'node:assert/strict';
import { loginSideShiftPreviewInCodex } from './agent-login-codex-preview.mjs';

const origin = 'https://sideshift-web-git-fix-switched-manager-requests-side-shift.vercel.app';
function fixture(url = `${origin}/signin`) {
  const writes = [];
  return {
    tab: { url: async () => url },
    field: { evaluate: async () => new URL(url).origin, fill: async value => writes.push(value), press: async key => writes.push(key) },
    writes,
  };
}

test('uses the saved production staff login only after Vercel verifies the preview', async () => {
  const b = fixture();
  const calls = [];
  const result = await loginSideShiftPreviewInCodex(b.tab, { item: 'SideShift User', fields: { password: b.field }, submit: true }, {
    run: (cmd, args) => { calls.push('verify'); assert.equal(cmd, 'vercel'); assert.deepEqual(args, ['inspect', new URL(origin).hostname, '--scope', 'side-shift']); },
    load: async (href, before, options) => { calls.push('load'); assert.equal(href, 'https://app.sideshift.app/signin'); assert.equal(options.item, 'SideShift User'); assert.equal(before.pass, true); return { password: 'synthetic-password' }; },
  });
  assert.deepEqual(calls, ['verify', 'load']);
  assert.deepEqual(b.writes, ['synthetic-password', 'Enter']);
  assert.deepEqual(result, { origin, filled: ['password'], missing: [], submitted: true });
});

test('refuses an unrelated shared-host tenant before verification or credentials', async () => {
  const b = fixture('https://sideshift-example-evil.vercel.app/signin');
  await assert.rejects(loginSideShiftPreviewInCodex(b.tab, { fields: { password: b.field } }, {
    run: () => assert.fail('must not verify'), load: () => assert.fail('must not load'),
  }), /SideShift preview/);
  assert.deepEqual(b.writes, []);
});

test('refuses unverified preview ownership without loading credentials', async () => {
  const b = fixture();
  await assert.rejects(loginSideShiftPreviewInCodex(b.tab, { fields: { password: b.field } }, {
    run: () => { throw new Error('refused'); }, load: () => assert.fail('must not load'),
  }), /could not confirm/);
  assert.deepEqual(b.writes, []);
});

test('keeps native cross-origin field protection before credential lookup', async () => {
  const b = fixture();
  b.field.evaluate = async () => 'https://evil.test';
  await assert.rejects(loginSideShiftPreviewInCodex(b.tab, { fields: { password: b.field } }, {
    run: () => {}, load: () => assert.fail('must not load'),
  }), /origin/);
  assert.deepEqual(b.writes, []);
});
