#!/usr/bin/env node
// board-priority.mjs: keeps Session Board fast when agents load the Mac.
//
// With ~30 agents the Mac runs 4-5 times more work than it has cores (load average 80 on 18
// cores, 11-12). macOS then gives the board's typing and scrolling the same turn as an agent's
// build. This moves agent work to macOS background priority (taskpolicy -b, as Time Machine
// runs): it runs on the slower cores and waits whenever a foreground app such as the board needs
// the CPU. Agents use the CPU you leave idle; builds and emulators run slower while you work.
//
// Background: every process a Claude or Codex session starts (shells, builds, tests, dev servers,
// emulators, MCP servers, hooks), and heavy tools that have left their session's process tree.
// Untouched: the session processes themselves (they draw the terminal you type into), the board,
// your own shells and every other app. Children inherit background priority, so a process is
// changed once. launchd keeps this running (launchd/com.sideshift.board-priority.plist).
//
// Usage:  board-priority.mjs           run forever
//         board-priority.mjs --once    one pass, print what it changed
import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const EVERY_MS = 5000
const LOG = join(homedir(), '.claude', 'logs', 'board-priority.log')
const LOG_MAX = 1024 * 1024
// The priority macOS gives a process in the background band.
const BACKGROUND_PRI = 4

// A Claude or Codex session: Claude Code's binary (claude, or its versioned name like 2.1.322),
// its daemon and terminal hosts ("claude bg-pty-host"), and Codex.
export function isSession(args) {
  const name = basename(args.split(' ')[0])
  return /^(claude|codex)$/.test(name) || /^\d+\.\d+\.\d+$/.test(name) || /\/codex( |$)|codex-darwin|@openai\/codex/.test(args)
}

// Work that loads the Mac and may have left its session's tree (a Gradle daemon, an emulator).
export function isHeavy(args) {
  const name = basename(args.split(' ')[0])
  return /^(java|qemu-system-[\w-]+|emulator|swift-frontend|swift-build|xcodebuild|clang|tsc|next-server.*|gradle)$/.test(name)
}

// Which processes to move to the background: rows of { pid, ppid, pri, args }.
export function toDemote(rows) {
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const underSession = (row) => {
    const seen = new Set()
    for (let up = byPid.get(row.ppid); up && !seen.has(up.pid); up = byPid.get(up.ppid)) {
      seen.add(up.pid)
      if (isSession(up.args)) return true
    }
    return false
  }
  return rows.filter((row) => row.pri > BACKGROUND_PRI && !isSession(row.args) && (underSession(row) || isHeavy(row.args)))
}

async function processes() {
  const { stdout } = await run('/bin/ps', ['-U', String(process.getuid()), '-o', 'pid=,ppid=,pri=,args='], { maxBuffer: 32 * 1024 * 1024 })
  return stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), pri: Number(match[3]), args: match[4] }] : []
  })
}

function log(line) {
  try {
    mkdirSync(join(homedir(), '.claude', 'logs'), { recursive: true })
    if (statSync(LOG, { throwIfNoEntry: false })?.size > LOG_MAX) renameSync(LOG, `${LOG}.1`)
    appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // a lost log line never stops the work
  }
}

async function pass() {
  const demote = toDemote(await processes())
  const moved = []
  for (const row of demote) {
    // A process that ended in between fails here; that is fine.
    const ok = await run('/usr/sbin/taskpolicy', ['-b', '-p', String(row.pid)]).then(() => true, () => false)
    if (ok) moved.push(basename(row.args.split(' ')[0]))
  }
  if (moved.length) {
    const counts = new Map()
    for (const name of moved) counts.set(name, (counts.get(name) ?? 0) + 1)
    log(`background ${moved.length}: ${[...counts].map(([name, n]) => `${name}×${n}`).join(' ')}`)
  }
  return moved
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  if (process.argv.includes('--once')) {
    console.log((await pass()).join('\n') || 'nothing to change')
  } else {
    log('start')
    for (;;) {
      await pass().catch((error) => log(`pass failed: ${error.message}`))
      await new Promise((resolve) => setTimeout(resolve, EVERY_MS))
    }
  }
}
