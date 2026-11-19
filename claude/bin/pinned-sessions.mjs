#!/usr/bin/env node
// pinned-sessions.mjs: which running Claude sessions you pinned in Session Board.
//
// Session Board keeps pins in its app data, by conversation id with the background job id. Each
// running Claude session writes ~/.claude/sessions/<pid>.json with both ids. A recompacted or
// resumed session gets a new conversation id but keeps its job id, so either one matches.
// board-priority.mjs keeps a pinned session's work at normal priority, and heavy lets its jobs go
// first in the queue.
//
// Usage:  pinned-sessions.mjs              print the pids of running pinned sessions
//         pinned-sessions.mjs --pid <pid>  exit 0 if <pid> runs inside a pinned session, else 1
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export const PINS_FILE = join(homedir(), 'Library', 'Application Support', 'Session Board', 'pins.json')
export const SESSIONS_DIR = join(homedir(), '.claude', 'sessions')

// The pids of sessions that match a pin. Nothing pinned, or no board, gives an empty set.
export function pinnedSessionPids({ pinsFile = PINS_FILE, sessionsDir = SESSIONS_DIR } = {}) {
  let pins
  try {
    pins = JSON.parse(readFileSync(pinsFile, 'utf8'))
  } catch {
    return new Set()
  }
  if (!pins || typeof pins !== 'object') return new Set()
  const keys = new Set(Object.keys(pins))
  const ids = new Set(Object.values(pins).filter((id) => typeof id === 'string'))
  if (!keys.size) return new Set()
  const pids = new Set()
  let files = []
  try {
    files = readdirSync(sessionsDir).filter((name) => name.endsWith('.json'))
  } catch {
    return pids
  }
  for (const name of files) {
    try {
      const session = JSON.parse(readFileSync(join(sessionsDir, name), 'utf8'))
      if (keys.has(session.sessionId) || ids.has(session.jobId)) pids.add(Number(session.pid))
    } catch {
      // a session file being rewritten; the next read gets it
    }
  }
  return pids
}

// True when `pid` or a process above it is in `pinned`. `parentOf` maps a pid to its parent.
export function underPinned(pid, parentOf, pinned) {
  const seen = new Set()
  for (let at = pid; at && at > 1 && !seen.has(at); at = parentOf.get(at)) {
    if (pinned.has(at)) return true
    seen.add(at)
  }
  return false
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const pinned = pinnedSessionPids()
  const at = process.argv.indexOf('--pid')
  if (at === -1) {
    console.log([...pinned].join('\n'))
  } else {
    if (!pinned.size) process.exit(1)
    const out = execFileSync('/bin/ps', ['-U', String(process.getuid()), '-o', 'pid=,ppid='], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 10_000 })
    const parentOf = new Map(out.split('\n').flatMap((line) => {
      const m = /^\s*(\d+)\s+(\d+)/.exec(line)
      return m ? [[Number(m[1]), Number(m[2])]] : []
    }))
    process.exit(underPinned(Number(process.argv[at + 1]), parentOf, pinned) ? 0 : 1)
  }
}
