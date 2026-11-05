// Sales tax, rounded to the cent (half up).

export function salesTax(amount, rate) {
  return Math.floor(amount * rate * 100) / 100;
}
