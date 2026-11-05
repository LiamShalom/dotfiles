import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const codeFiles = ['cli.js', ...readdirSync(join(root, 'src')).map((f) => join('src', f)), ...readdirSync(join(root, 'test')).map((f) => join('test', f))];

test('no amt identifier is left in the code', () => {
  for (const f of codeFiles) {
    if (!f.endsWith('.js')) continue;
    assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /\bamt\b/, f);
  }
});

test('the summary CLI still works on the sample data', () => {
  const out = JSON.parse(execFileSync('node', ['cli.js', 'summary', 'orders.json'], { cwd: root, encoding: 'utf8' }));
  assert.equal(out.count, 3);
  assert.equal(out.revenue, 213.75);
  assert.equal(out.topCustomer, 'Ada');
});

test('the visible tests still pass', () => {
  execFileSync('npm', ['test'], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
});
