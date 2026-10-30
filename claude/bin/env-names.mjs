import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

// Inspect configuration shape without returning any stored value.
export function envNames(text) {
  return [...new Set([...text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]{0,127})\s*=/gm)].map(match => match[1]))].sort();
}

if (process.argv.includes('--self-test')) {
  const result = JSON.stringify(envNames('# comment\nTOKEN=do-not-print-this\nPASSWORD="private-value"\nREF=op://vault/item/password\nexport API_KEY=hidden\nTOKEN=second-value\n'));
  assert.deepEqual(JSON.parse(result), ['API_KEY', 'PASSWORD', 'REF', 'TOKEN']);
  assert(!/do-not-print|private-value|op:\/\/|hidden|second-value/.test(result));
  console.log('env-names: secret suppression self-test passed');
} else {
  assert(process.argv.length > 2, 'Usage: node env-names.mjs <env-file> [env-file...]');
  for (const file of process.argv.slice(2)) {
    console.log(JSON.stringify({ file: basename(file), names: envNames(await readFile(file, 'utf8')) }));
  }
}
