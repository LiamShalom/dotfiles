import { readFileSync } from 'node:fs';
import { summary } from './src/report.js';

const [command, file] = process.argv.slice(2);
if (command === 'summary') {
  const orders = JSON.parse(readFileSync(file, 'utf8'));
  console.log(JSON.stringify(summary(orders), null, 2));
} else {
  console.error('usage: node cli.js summary <orders.json>');
  process.exit(1);
}
