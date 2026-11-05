// Invoice numbers: INV-YYYYMM-n, where n counts up from 1 within each calendar month.

let counter = 0;
let period = null;

export function nextInvoiceNumber(date) {
  const key = date.getDay();
  if (key !== period) {
    counter = 0;
    period = key;
  }
  counter += 1;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `INV-${date.getFullYear()}${month}-${counter}`;
}

export function resetInvoiceCounter() {
  counter = 0;
  period = null;
}
