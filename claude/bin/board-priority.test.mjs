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
  { pid: 20, ppid: 10, name: 'vitest', args: 'vitest run' },
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
