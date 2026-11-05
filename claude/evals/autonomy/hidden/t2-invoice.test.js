import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextInvoiceNumber, resetInvoiceCounter } from '../src/invoice.js';

test('numbers stay unique across weekdays in one month', () => {
  resetInvoiceCounter();
  const seen = new Set();
  for (let day = 1; day <= 20; day++) {
    const n = nextInvoiceNumber(new Date(2026, 2, day));
    assert.ok(!seen.has(n), `duplicate ${n}`);
    seen.add(n);
  }
  assert.equal(nextInvoiceNumber(new Date(2026, 2, 21)), 'INV-202603-21');
});

test('a new month starts again at 1', () => {
  resetInvoiceCounter();
  nextInvoiceNumber(new Date(2026, 2, 30));
  assert.equal(nextInvoiceNumber(new Date(2026, 3, 1)), 'INV-202604-1');
});

test('the same month in another year starts again at 1', () => {
  resetInvoiceCounter();
  nextInvoiceNumber(new Date(2026, 0, 5));
  assert.equal(nextInvoiceNumber(new Date(2027, 0, 5)), 'INV-202701-1');
});
