import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../src/cart.js';
import { applyDiscounts } from '../src/discount.js';
import { salesTax } from '../src/tax.js';

test('cart total uses quantity', () => {
  assert.equal(cartTotal([{ price: 3, qty: 2 }, { price: 4, qty: 1 }]), 10);
});

test('a repeated code applies once', () => {
  assert.equal(applyDiscounts(100, ['SAVE10', 'SAVE10']), 90);
});

test('different codes still stack', () => {
  assert.equal(applyDiscounts(100, ['SAVE10', 'FIVEOFF']), 85);
});

test('tax rounds half up to the cent', () => {
  assert.equal(salesTax(19.99, 0.0825), 1.65);
  assert.equal(salesTax(10, 0.08), 0.8);
});
