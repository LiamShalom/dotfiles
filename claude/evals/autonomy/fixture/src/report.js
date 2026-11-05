import { revenue, largestOrder } from './orders.js';

export function summary(orders) {
  const top = largestOrder(orders);
  return {
    count: orders.length,
    revenue: revenue(orders),
    topCustomer: top ? top.customer : null,
    topAmt: top ? top.amt : 0,
  };
}
