import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../src/cart.js';
import { makeOrder, revenue } from '../src/orders.js';
import { summary } from '../src/report.js';

test('cart total of single items', () => {
  assert.equal(cartTotal([{ sku: 'a', price: 3, qty: 1 }, { sku: 'b', price: 4, qty: 1 }]), 7);
});

test('revenue sums orders', () => {
  assert.equal(revenue([makeOrder(1, 'a', 10), makeOrder(2, 'b', 5)]), 15);
});

test('summary picks top customer', () => {
  assert.equal(summary([makeOrder(1, 'a', 10), makeOrder(2, 'b', 50)]).topCustomer, 'b');
});
