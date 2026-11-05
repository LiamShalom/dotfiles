// Discount codes. Each code may be used once per order.

const CODES = {
  SAVE10: (total) => total * 0.9,
  FIVEOFF: (total) => Math.max(0, total - 5),
};

export function applyDiscounts(total, codes) {
  let result = total;
  for (const code of codes) {
    const apply = CODES[code];
    if (apply) result = apply(result);
  }
  return Math.round(result * 100) / 100;
}
