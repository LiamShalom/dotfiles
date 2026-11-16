#!/usr/bin/env node
// When Liam adds :eyes: to a Slack message, reply in its thread as Liam ("taking a look") and start
// a background Claude session that runs the slack-eyes skill on it: diagnose, fix if needed, reply.
//
// launchd runs this every 30 s (com.sideshift.slack-eyes). One Slack call per run.
//   slack-eyes.mjs            check once
//   slack-eyes.mjs --dry-run  print what it would do; post and launch nothing
//   slack-eyes.mjs --baseline mark every current :eyes: as handled, then exit
// Pause: touch ~/.claude/state/slack-eyes.PAUSED   Log: ~/.claude/logs/slack-eyes.log
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()
const LIAM = 'U0B78R52DFT'
const SELF_DM = 'D0B70K2EB9R'
const CLAUDE = join(HOME, '.local/bin/claude')
const REPO = join(HOME, 'sideshift-monorepo')
const STATE_DIR = join(HOME, '.claude/state')
const STATE = join(STATE_DIR, 'slack-eyes.json')
const PAUSED = join(STATE_DIR, 'slack-eyes.PAUSED')
const LOG = join(HOME, '.claude/logs/slack-eyes.log')
const VOICE = join(HOME, '.claude/slack-voice.md')
const MAX_PER_RUN = 3

// Used when the voice file has no "Acknowledgements" list. Liam's style: lowercase, no end punctuation.
const DEFAULT_ACKS = ['taking a look', 'looking into it', 'on it, checking now', 'checking this now', 'digging in', 'looking now']

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')

const log = (event, fields = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), event, ...fields })
  if (dryRun) console.log(line)
  else appendFileSync(LOG, line + '\n')
}

// Liam's user token, the one slack-as-liam uses. Called directly: the slack CLI sometimes stalls
// for 30 s or more under launchd, which would delay the acknowledgement.
let token
const slack = async (method, params) => {
  token ??= execFileSync('security', ['find-generic-password', '-s', 'claude-slack-user-token', '-w'], { encoding: 'utf8', timeout: 10_000 }).trim()
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])),
    signal: AbortSignal.timeout(15_000),
  })
  const json = await response.json()
  if (!json.ok) throw new Error(`${method}: ${json.error}`)
  return json
}

// null only when there is no state yet. A damaged file stops the run: re-baselining would drop pending :eyes:.
const readState = () => {
  if (!existsSync(STATE)) return null
  const state = JSON.parse(readFileSync(STATE, 'utf8'))
  if (!Array.isArray(state?.seen)) throw new Error(`${STATE} has no seen list; fix it or run --baseline`)
  return state
}
const writeState = (state) => {
  writeFileSync(STATE + '.tmp', JSON.stringify(state, null, 2))
  renameSync(STATE + '.tmp', STATE)
}

export function acksFromVoice(text) {
  const section = /^##+\s*Acknowledg\w*[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(text)?.[1] ?? ''
  return section.split('\n')
    .map((line) => /^\s*(?:[-*]|\d+[.)])\s+["“]?(.+?)["”]?\s*$/.exec(line)?.[1])
    .filter((ack) => ack && ack.length <= 60 && !/[*_`]/.test(ack))
}

export function eyesItems(items) {
  return items
    .filter((item) => item.type === 'message' && item.message?.ts)
    .filter((item) => (item.message.reactions ?? []).some((r) => r.name === 'eyes' && r.users?.includes(LIAM)))
    .map((item) => ({
      key: `${item.channel}:${item.message.ts}`,
      channel: item.channel,
      ts: item.message.ts,
      threadTs: item.message.thread_ts ?? item.message.ts,
      author: item.message.user ?? item.message.bot_id ?? null,
    }))
}

const pickAck = (state) => {
  let acks = DEFAULT_ACKS
  try {
    const fromVoice = acksFromVoice(readFileSync(VOICE, 'utf8'))
    if (fromVoice.length >= 3) acks = fromVoice
  } catch {}
  const others = acks.filter((a) => a !== state.lastAck)
  const choices = others.length ? others : acks
  return choices[Math.floor(Math.random() * choices.length)]
}

const prompt = (hit, permalink) => `Use the slack-eyes skill on this Slack message. Liam added :eyes: to it, and the watcher already replied in its thread as Liam to say he is taking a look.

Message: ${permalink}
Channel: ${hit.channel}
Message ts: ${hit.ts}
Thread ts (reply here): ${hit.threadTs}

This is an unattended run started by that reaction: nobody will answer questions. Liam's :eyes: is his approval for the steps the slack-eyes skill lists, and only those.`

// `claude --bg` starts the session, prints its id and exits. Throws when it did not start.
const launch = (hit, permalink) => {
  const name = `slack-eyes ${hit.channel}-${hit.ts}`
  const run = spawnSync(CLAUDE, ['--bg', '-n', name, prompt(hit, permalink)], {
    cwd: REPO, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${HOME}/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin` },
  })
  if (run.error) throw run.error
  if (run.status !== 0) throw new Error(`claude --bg exited ${run.status}: ${(run.stderr || run.stdout || '').trim().slice(0, 300)}`)
  return { name, id: /claude stop ([0-9a-f]+)/.exec(run.stdout)?.[1] ?? null }
}

// Every page of reactions.list, so a baseline marks all of Liam's existing :eyes:, not only the newest 50.
const allEyes = async () => {
  const items = []
  let cursor = ''
  for (let page = 0; page < 40; page++) {
    const result = await slack('reactions.list', { user: LIAM, limit: 100, full: 'true', ...(cursor && { cursor }) })
    items.push(...eyesItems(result.items ?? []))
    cursor = result.response_metadata?.next_cursor ?? ''
    if (!cursor) break
  }
  return items
}

async function main() {
  mkdirSync(STATE_DIR, { recursive: true })
  mkdirSync(join(HOME, '.claude/logs'), { recursive: true })
  if (existsSync(PAUSED) && !dryRun) return

  let state = readState()

  // First run (or --baseline): everything already reacted to is old. Only new :eyes: start work.
  if (!state || args.has('--baseline')) {
    const items = await allEyes()
    state = { seen: [...new Set([...(state?.seen ?? []), ...items.map((i) => i.key)])], lastAck: state?.lastAck ?? null }
    if (!dryRun) writeState(state)
    log('baseline', { marked: items.length })
    return
  }

  const items = eyesItems((await slack('reactions.list', { user: LIAM, limit: 50, full: 'true' })).items ?? [])
  const seen = new Set(state.seen)
  const fresh = items.filter((i) => !seen.has(i.key)).reverse().slice(0, MAX_PER_RUN)
  for (const hit of fresh) {
    // Mark first: a crash after posting must never post or launch twice.
    state.seen.push(hit.key)
    // Liam's own messages run only in his DM with himself, where he pastes issues to hand off.
    if (hit.author === LIAM && hit.channel !== SELF_DM) {
      log('skipped_own_message', { key: hit.key })
      if (!dryRun) writeState(state)
      continue
    }
    const ack = pickAck(state)
    state.lastAck = ack
    if (dryRun) { log('would_handle', { key: hit.key, threadTs: hit.threadTs, ack }); continue }
    writeState(state)
    try {
      await slack('chat.postMessage', { channel: hit.channel, thread_ts: hit.threadTs, text: ack })
      log('acked', { key: hit.key, ack })
    } catch (error) {
      log('ack_failed', { key: hit.key, error: String(error.message ?? error) })
    }
    let permalink = `https://sideshift-group.slack.com/archives/${hit.channel}/p${hit.ts.replace('.', '')}`
    try { permalink = (await slack('chat.getPermalink', { channel: hit.channel, message_ts: hit.ts })).permalink } catch {}
    try {
      const session = launch(hit, permalink)
      log('launched', { key: hit.key, session: session.name, id: session.id, permalink })
    } catch (error) {
      log('launch_failed', { key: hit.key, error: String(error.message ?? error) })
    }
  }
}

if (process.argv[1]?.endsWith('slack-eyes.mjs')) {
  main().catch((error) => { log('run_failed', { error: String(error.message ?? error) }); process.exitCode = 1 })
}
