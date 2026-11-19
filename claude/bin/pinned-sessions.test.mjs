import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pinnedSessionPids, underPinned } from './pinned-sessions.mjs'

function fixture(pins) {
  const dir = mkdtempSync(join(tmpdir(), 'pinned-'))
  const sessionsDir = join(dir, 'sessions')
  mkdirSync(sessionsDir)
  const write = (pid, sessionId, jobId) => writeFileSync(join(sessionsDir, `${pid}.json`), JSON.stringify({ pid, sessionId, jobId }))
  write(100, 'aaaa1111-0000', 'aaaa1111')
  // resumed after a recompact: new conversation id, same job id
  write(200, 'cccc3333-0000', 'bbbb2222')
  write(300, 'dddd4444-0000', 'dddd4444')
  writeFileSync(join(sessionsDir, 'broken.json'), '{')
  const pinsFile = join(dir, 'pins.json')
  if (pins !== undefined) writeFileSync(pinsFile, typeof pins === 'string' ? pins : JSON.stringify(pins))
  return { pinsFile, sessionsDir }
}

test('a pin matches a session by conversation id or by job id', () => {
  const paths = fixture({ 'aaaa1111-0000': 'aaaa1111', 'bbbb2222-0000': 'bbbb2222', 'eeee5555-0000': null })
  assert.deepEqual([...pinnedSessionPids(paths)].sort(), [100, 200])
})

test('no pins file, or an unreadable one, pins nothing', () => {
  assert.equal(pinnedSessionPids(fixture()).size, 0)
  assert.equal(pinnedSessionPids(fixture('{')).size, 0)
})

test('a process is inside a pinned session when the session is above it', () => {
  const parentOf = new Map([[5, 4], [4, 100], [100, 1], [9, 300], [300, 1]])
  assert.equal(underPinned(5, parentOf, new Set([100])), true)
  assert.equal(underPinned(9, parentOf, new Set([100])), false)
  assert.equal(underPinned(42, parentOf, new Set([100])), false)
})
