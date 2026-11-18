import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toDemote, toPromote } from './board-priority.mjs'

const slotArgs = 'lockf -s -t 0 /tmp/agent-heavy-501/slot.2 /bin/sh -c : > "$1"; exec "$@" sh /tmp/agent-heavy-501/started.1 /tmp/agent-heavy-501/queued.1 npm run build:packages'
const rows = [
  { pid: 10, ppid: 1, name: 'claude', args: 'claude' },
  { pid: 11, ppid: 10, name: 'zsh', args: 'zsh -c heavy npm run build:packages' },
  { pid: 12, ppid: 11, name: 'bash', args: '/bin/bash /Users/x/.claude/bin/heavy npm run build:packages' },
  { pid: 13, ppid: 12, name: 'lockf', args: slotArgs },
  { pid: 14, ppid: 13, name: 'npm', args: 'npm run build:packages' },
  { pid: 15, ppid: 14, name: 'node', args: 'node tsc -b' },
  { pid: 20, ppid: 10, name: 'zsh', args: 'zsh -c npx vitest run a.test.ts' },
]
const pids = (list) => list.map((row) => row.pid).sort((a, b) => a - b)

test('a job holding a heavy slot runs at normal priority, with everything under it', () => {
  assert.deepEqual(pids(toPromote(rows)), [13, 14, 15])
})

test('other session work, including the queued waiter, stays in the background', () => {
  assert.deepEqual(pids(toDemote(rows)), [11, 12, 20])
})

test('a lockf that is not a heavy slot is not promoted', () => {
  const other = [{ pid: 30, ppid: 10, name: 'lockf', args: 'lockf /tmp/something.lock make' }, rows[0]]
  assert.deepEqual(pids(toPromote(other)), [])
  assert.deepEqual(pids(toDemote(other)), [30])
})

test('a targeted test run or type check runs at normal priority, with its workers', () => {
  const runs = [
    rows[0],
    { pid: 40, ppid: 10, name: 'zsh', args: 'zsh -c npx vitest run a.test.ts' },
    { pid: 41, ppid: 40, name: 'npm', args: 'npm exec vitest run a.test.ts' },
    { pid: 42, ppid: 41, name: 'node', args: 'node /w/node_modules/.bin/vitest run a.test.ts' },
    { pid: 43, ppid: 42, name: 'node', args: '/opt/homebrew/bin/node --require /w/node_modules/vitest/suppress-warnings.cjs /w/node_modules/vitest/dist/workers/forks.js' },
    { pid: 50, ppid: 10, name: 'tsc', args: '/w/node_modules/@typescript/typescript-darwin-arm64/lib/tsc -p tsconfig.json --noEmit' },
    { pid: 51, ppid: 10, name: 'node', args: 'node /w/node_modules/.bin/playwright test e2e/a.spec.ts' },
    { pid: 60, ppid: 10, name: 'tsc', args: '/w/node_modules/@typescript/typescript-darwin-arm64/lib/tsc --lsp --stdio' },
  ]
  assert.deepEqual(pids(toPromote(runs)), [42, 43, 50, 51])
  assert.deepEqual(pids(toDemote(runs)), [40, 41, 60])
})
