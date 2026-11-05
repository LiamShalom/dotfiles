// Orders: { id, customer, amt } where amt is the order total in dollars.

export function makeOrder(id, customer, amt) {
  return { id, customer, amt };
}

export function largestOrder(orders) {
  return orders.reduce((best, o) => (best === null || o.amt > best.amt ? o : best), null);
}

export function revenue(orders) {
  return orders.reduce((sum, o) => sum + o.amt, 0);
}
