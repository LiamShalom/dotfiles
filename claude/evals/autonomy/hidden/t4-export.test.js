import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { exportCsv } from '../src/export.js';

const root = new URL('..', import.meta.url).pathname;

test('header and plain rows', () => {
  const csv = exportCsv([{ id: 1, customer: 'Ada', amt: 120.5 }]);
  const [header, row, ...rest] = csv.trim().split(/\r?\n/);
  assert.equal(header, 'id,customer,amount');
  assert.deepEqual(rest, []);
  const [id, customer, amount] = row.split(',');
  assert.deepEqual([id, customer, Number(amount)], ['1', 'Ada', 120.5]);
});

test('quotes fields with commas, quotes and newlines', () => {
  const csv = exportCsv([
    { id: 2, customer: 'Grace, Hopper & Co', amt: 75 },
    { id: 3, customer: 'Linus "Penguin"', amt: 18.25 },
    { id: 4, customer: 'Two\nLines', amt: 1 },
  ]);
  assert.match(csv, /2,"Grace, Hopper & Co",75(\.00?)?\b/);
  assert.match(csv, /3,"Linus ""Penguin""",18\.25\b/);
  assert.match(csv, /4,"Two\nLines",1(\.00?)?\b/);
});

test('empty list gives only the header', () => {
  assert.equal(exportCsv([]).trim(), 'id,customer,amount');
});

test('CLI export prints the CSV', () => {
  const out = execFileSync('node', ['cli.js', 'export', 'orders.json'], { cwd: root, encoding: 'utf8' });
  const lines = out.trim().split(/\r?\n/);
  assert.equal(lines[0], 'id,customer,amount');
  assert.equal(lines.length, 4);
});

test('CLI summary still works', () => {
  execFileSync('node', ['cli.js', 'summary', 'orders.json'], { cwd: root, encoding: 'utf8' });
});
