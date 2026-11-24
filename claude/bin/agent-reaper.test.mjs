import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { carryNudged, chatStatuses, nudgeText, orphans, paneTabIds, stalledChats } from './agent-reaper.mjs'

const MIN = 60e3
const now = Date.parse('2026-11-19T22:30:00Z')
const chat = (over) => ({ id: 'aaaa1111', pid: 1, name: 'chat', status: 'shell', statusAt: now - 50 * MIN, jobState: 'working', jobAt: now - 50 * MIN, ...over })

test('a chat parked on its own shell, still Working, quiet past the limit, is stalled', () => {
  assert.deepEqual(stalledChats([chat()], now, 45 * MIN).map((c) => c.id), ['aaaa1111'])
})

test('busy, idle, blocked, recent or freshly updated chats are not stalled', () => {
  const chats = [
    chat({ id: 'busy', status: 'busy' }),
    chat({ id: 'idle', status: 'idle' }),
    chat({ id: 'blocked', jobState: 'blocked' }),
    chat({ id: 'recent', statusAt: now - 20 * MIN, jobAt: now - 20 * MIN }),
    // its job state moved on (a subagent reported) after the turn ended
    chat({ id: 'jobmoved', jobAt: now - 5 * MIN }),
  ]
  assert.deepEqual(stalledChats(chats, now, 45 * MIN), [])
})

test('one nudge per stretch: the same statusAt is not nudged twice, a new stretch is', () => {
  const c = chat()
  assert.deepEqual(stalledChats([c], now, 45 * MIN, { aaaa1111: c.statusAt }), [])
  const later = chat({ statusAt: now - 46 * MIN, jobAt: now - 46 * MIN })
  assert.equal(stalledChats([later], now, 45 * MIN, { aaaa1111: c.statusAt }).length, 1)
})

test('a run that misses the chat does not lead to a second nudge for the same stretch', () => {
  const c = chat()
  let memory = { aaaa1111: c.statusAt }
  memory = carryNudged(memory, [], now) // ps failed: no chats seen
  assert.deepEqual(stalledChats([c], now + 5 * MIN, 45 * MIN, memory), [])
  // a new stretch drops the old entry, and an entry over a week old goes
  assert.deepEqual(carryNudged(memory, [chat({ statusAt: now })], now), {})
  assert.deepEqual(carryNudged(memory, [], now + 8 * 86400e3), {})
})

test('chatStatuses joins live registry entries with their job state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reaper-'))
  const reg = join(dir, 'sessions')
  const jobs = join(dir, 'jobs')
  mkdirSync(reg)
  mkdirSync(join(jobs, 'aaaa1111'), { recursive: true })
  writeFileSync(join(reg, '10.json'), JSON.stringify({ pid: 10, jobId: 'aaaa1111', name: 'melaxin', status: 'shell', statusUpdatedAt: 5, cwd: '/x' }))
  writeFileSync(join(reg, '11.json'), JSON.stringify({ pid: 11, jobId: 'dead', status: 'shell', statusUpdatedAt: 5 }))
  writeFileSync(join(reg, '12.json'), JSON.stringify({ pid: 12, status: 'busy' }))
  writeFileSync(join(reg, 'bad.json'), '{')
  writeFileSync(join(jobs, 'aaaa1111', 'state.json'), JSON.stringify({ state: 'working', updatedAt: '2026-11-19T14:18:28.760Z' }))
  const out = chatStatuses(new Set([10, 12]), reg, jobs)
  assert.deepEqual(out, [{ id: 'aaaa1111', pid: 10, name: 'melaxin', status: 'shell', statusAt: 5, jobState: 'working', jobAt: Date.parse('2026-11-19T14:18:28.760Z') }])
})

test('the nudge names the minutes and the conflicted-PR trap', () => {
  const t = nudgeText(50)
  assert.match(t, /50 min ago/)
  assert.match(t, /mergeStateStatus/)
})

test('the pane tabs are read from Session Board pane.json; a missing or broken file spares nothing', () => {
	const dir = mkdtempSync(join(tmpdir(), 'reaper-pane-'))
	const file = join(dir, 'pane.json')
	writeFileSync(file, JSON.stringify({ open: true, tabs: [{ id: 'AAA', owner: 'c1' }, { id: 'BBB', owner: null }, { owner: 'x' }] }))
	assert.deepEqual([...paneTabIds(file)], ['AAA', 'BBB'])
	writeFileSync(file, 'not json')
	assert.equal(paneTabIds(file).size, 0)
	assert.equal(paneTabIds(join(dir, 'missing.json')).size, 0)
})

test('a read-only Vercel CLI call left under launchd is an orphan; one with a live parent or vercel dev is not', () => {
	const native = '/opt/homebrew/lib/node_modules/vercel/node_modules/@vercel/vc-native-darwin-arm64/bin/vercel'
	const procs = [
		{ pid: 999901, ppid: 1, ageSec: 7200, cmd: `${native} inspect sideshift-web-git-x-side-shift.vercel.app --scope side-shift` },
		{ pid: 999902, ppid: 1, ageSec: 7200, cmd: 'node /opt/homebrew/bin/vercel logs https://x.vercel.app' },
		{ pid: 999903, ppid: 4242, ageSec: 7200, cmd: `${native} inspect x.vercel.app` },
		{ pid: 999904, ppid: 1, ageSec: 7200, cmd: 'node /opt/homebrew/bin/vercel dev' },
	]
	const found = orphans(procs)
	assert.deepEqual(found.map((o) => [o.pid, o.kind]), [[999901, 'vercel'], [999902, 'vercel']])
})
