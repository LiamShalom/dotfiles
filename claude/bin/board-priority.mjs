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
// MCP servers, hooks); the agents' shared services (headless agent Chrome, MCP bridges); iOS
// simulators and the Docker VM; and heavy tools that run detached from any terminal (a Gradle
// daemon, the Android emulator). Untouched: the session processes themselves (they draw the
// terminal you type into), the board, and what you start yourself from a terminal. Also in the
// background: every iOS simulator and any Gradle daemon, whoever started them.
// Children inherit background priority, so a process is changed once. launchd keeps this running
// (launchd/com.sideshift.board-priority.plist).
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
const CALL_TIMEOUT_MS = 10_000
// Younger processes are left alone: most agent commands end within seconds, and changing each one
// would start a process for nothing. Long work is caught on the next pass.
const MIN_AGE_S = 5
const LOG = join(homedir(), '.claude', 'logs', 'board-priority.log')
const LOG_MAX = 1024 * 1024

// A Claude or Codex session: Claude Code's binary (claude, or its versioned name like 2.1.322,
// wherever it is installed), its daemon's helpers ("claude bg-pty-host" carries what you type to a
// background session) and the Codex binary.
export function isSession(row) {
  return /^(claude|codex)( |$)/.test(row.name) || /^\d+\.\d+\.\d+$/.test(row.name)
}

// Work that serves agents but is not started inside a session's process tree.
export function isAgentService(row) {
  return (
    row.name === 'launchd_sim' ||
    row.name === 'limactl' ||
    row.name === 'com.apple.Virtualization.VirtualMachine' ||
    /agent-chrome\/profile/.test(row.args) ||
    /\/mcp-http-bridge\.mjs/.test(row.args)
  )
}

// Heavy tools. Demoted only when they run detached from any terminal or app (a Gradle daemon, an
// emulator): the same tool started from your own shell stays at full speed.
export function isHeavy(row) {
  // Java only as a build daemon: an IDE such as Android Studio also runs as java.
  if (row.name === 'java') return /GradleDaemon|KotlinCompileDaemon|org\.gradle\./.test(row.args)
  // tsc and Next run as node: match them by their arguments.
  if (row.name === 'node') return /\/tsc( |$)|next-server|\/next (dev|start)/.test(row.args)
  return /^(qemu-system-[\w-]+|emulator|gradle)$/.test(row.name)
}

// Xcode's asset catalog compiler and its simulator helper. In the background band on a busy Mac
// they never finish (11-16: FrostedUI's 5,670-icon catalog ran past 30 minutes and hung every iOS
// build; at normal priority it took 3 minutes). They inherit background from xcodebuild, so they
// are moved back to normal priority. Each runs for a few minutes per build.
export function isAssetCompiler(row) {
  return /^(actool|ibtool|ibtoold|AssetCatalogSimulatorAgent)$/.test(row.name)
}

// A job that holds a heavy-queue slot (~/.claude/bin/heavy runs it under `lockf <slot file>`).
// At most five run at once (2 general, 1 build, 2 iOS), and every other queued job waits on
// them. In the background band the disk throttle stretched them 30-100x (11-17: a 1-minute
// package build took 88 minutes), so 25 jobs waited up to 6 hours behind two slots. They run at
// normal priority instead, with everything they start.
export function isSlotHolder(row) {
  return row.name === 'lockf' && /\/agent-heavy-\d+\/\w+\.\d+ /.test(row.args)
}

// A test run or type check. Targeted runs skip the heavy queue on purpose, so the slot exemption
// above never reached them, and in the background band the disk throttle stretched them the same
// way (11-18: one small test file took 18 s at normal priority and was still running after 52 min
// in the background). They run at normal priority, with their workers. The editor's tsc --lsp
// helper stays in the background.
export function isTestRun(row) {
  if (/(^|\s)--lsp(\s|$)/.test(row.args)) return false
  if (row.name === 'vitest' || row.name === 'jest' || row.name === 'tsc') return true
  return /\/vitest(\/dist\/workers\/|\.mjs| |$)|\/\.bin\/(vitest|jest|tsc)( |$)|\/lib\/tsc( |$)|\/playwright test( |$)|\/\.bin\/playwright test( |$)/.test(row.args)
}

function ancestorsIn(rows) {
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  return (row) => {
    const chain = []
    const seen = new Set([row.pid])
    for (let up = byPid.get(row.ppid); up && !seen.has(up.pid); up = byPid.get(up.ppid)) {
      seen.add(up.pid)
      chain.push(up)
    }
    return chain
  }
}

function inSlot(row, chain) {
  return isSlotHolder(row) || chain.some(isSlotHolder) || isTestRun(row) || chain.some(isTestRun)
}

// Which processes to move back to normal priority.
export function toPromote(rows) {
  const ancestors = ancestorsIn(rows)
  return rows.filter((row) => isAssetCompiler(row) || inSlot(row, ancestors(row)))
}

// Which processes to move to the background: rows of { pid, ppid, name, args }.
export function toDemote(rows) {
  const ancestors = ancestorsIn(rows)
  return rows.filter((row) => {
    if (isSession(row) || isAssetCompiler(row)) return false
    const chain = ancestors(row)
    if (inSlot(row, chain)) return false
    if (isAgentService(row) || chain.some((up) => isSession(up) || isAgentService(up))) return true
    // Detached: every process above it is another heavy tool (the emulator above its qemu). Rows
    // of other users and launchd itself are not listed, so a chain ends there.
    return isHeavy(row) && chain.every(isHeavy)
  })
}

// ps elapsed time, [[dd-]hh:]mm:ss, in seconds.
export function seconds(etime) {
  const [days, clock] = etime.includes('-') ? etime.split('-') : ['0', etime]
  return Number(days) * 86400 + clock.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

async function processes() {
  const ps = (columns) => run('/bin/ps', ['-U', String(process.getuid()), '-o', columns], { maxBuffer: 64 * 1024 * 1024, timeout: CALL_TIMEOUT_MS })
  // Two listings: the program path and the arguments can each contain spaces.
  const [comm, args] = await Promise.all([ps('pid=,ppid=,etime=,comm='), ps('pid=,args=')])
  const argsOf = new Map()
  for (const line of args.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (match) argsOf.set(Number(match[1]), match[2])
  }
  return comm.stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!match) return []
    const pid = Number(match[1])
    return [{ pid, ppid: Number(match[2]), ageS: seconds(match[3]), name: basename(match[4]), args: argsOf.get(pid) ?? '' }]
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

// Processes already moved, by pid: the flag used and their arguments (to tell a reused pid apart).
const moved = new Map()

async function pass() {
  const rows = await processes()
  const live = new Set(rows.map((row) => row.pid))
  for (const pid of moved.keys()) if (!live.has(pid)) moved.delete(pid)
  const changed = []
  const promoted = []
  const plan = [
    ...toDemote(rows).map((row) => [row, '-b', changed]),
    ...toPromote(rows).map((row) => [row, '-B', promoted]),
  ]
  for (const [row, flag, list] of plan) {
    if (row.ageS < MIN_AGE_S) continue
    // Keyed with the flag: a job demoted before it took a heavy slot must still be promoted.
    if (moved.get(row.pid) === `${flag} ${row.args}`) continue
    // A process that ended in between fails here; that is fine.
    const ok = await run('/usr/sbin/taskpolicy', [flag, '-p', String(row.pid)], { timeout: CALL_TIMEOUT_MS }).then(() => true, () => false)
    if (!ok) continue
    moved.set(row.pid, `${flag} ${row.args}`)
    list.push(row.name)
  }
  const summary = (names) => {
    const counts = new Map()
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
    return `${names.length}: ${[...counts].map(([name, n]) => `${name}×${n}`).join(' ')}`
  }
  if (changed.length) log(`background ${summary(changed)}`)
  if (promoted.length) log(`normal ${summary(promoted)}`)
  return [...changed, ...promoted.map((name) => `${name} (normal)`)]
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
