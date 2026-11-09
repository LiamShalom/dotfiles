#!/usr/bin/env node
// open-to-pane.mjs — PreToolUse hook on Bash for Claude Code. A session that runs
// `open <url | page | image | pdf | md | folder>` to show Liam something would open
// it in the default browser (Arc) or another app. While Session Board runs, the
// command becomes open-in-pane.sh, which shows each target in the board's browser
// pane. Any other command, `open -a App`, `open -R`, an app bundle, or a file the pane
// does not show, passes through untouched.
//
// Usage (settings): node ~/.claude/hooks/open-to-pane.mjs
import { appendFileSync, globSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'

const PANE = new Set('html htm svg png jpg jpeg gif webp avif pdf mp4 webm md'.split(' '))
const BUNDLE = /\.(app|bundle|framework|pkg|prefpane|workflow|xcodeproj|xcworkspace)\/?$/i
// `open` flags that still mean "open this in its usual app"; any other flag passes through.
const PLAIN_FLAGS = new Set(['-g', '-n', '-F', '-j', '-u'])

let input
try {
  input = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  process.exit(0)
}
const cmd = input?.tool_input?.command
// A run of the script, not a commit message or grep that only names it.
if (typeof cmd === 'string' && /\bnode\s+\S*board-browser\.mjs(\s|$)/.test(cmd) && !cmd.includes('--simulator')) boardBrowserCheck(cmd)
if (typeof cmd !== 'string' || !/^\s*open\s/.test(cmd)) process.exit(0)

// A board-browser.mjs hand-off. On 10-21 and 10-22 Liam could not see a page the agent said was in the pane: the
// agent closed the tab the board opened, or overrode CLAUDE_CODE_SESSION_ID so the tab went outside his pane, and
// said "it's there" without a screenshot. The override is refused; every other hand-off gets the check to run first.
// A /dev-*-preview route is a fixture page, not the product. On 11-08 Liam asked twice to see "the actual
// platform" and was shown the dev route again ("stop opening the brief pages preview, open the actual vercedl
// preview"). It opens only when the operator asked for that route or to compare directions: DEV_PREVIEW_OK=1.
function boardBrowserCheck(command) {
  const devRoute = /\/dev-[a-z0-9-]+-preview\b/i.test(command) && !/\bDEV_PREVIEW_OK=1\b/.test(command)
  const out = /\bCLAUDE_CODE_SESSION_ID=/.test(command)
    ? {
        permissionDecision: 'deny',
        permissionDecisionReason: 'Do not override CLAUDE_CODE_SESSION_ID for board-browser.mjs: the board then opens the tab outside the pane the operator is looking at. Run it as it is; the tab it opens is the pane\'s tab.',
      }
    : devRoute
    ? {
        permissionDecision: 'deny',
        permissionDecisionReason: 'That is a /dev-*-preview fixture route. The operator reviews the real page on the Vercel preview (the real campaign, profile or settings page, signed in), not the fixture route. Open the real page instead; if what he asked for is not on the real page yet, say so. Only when he asked for the dev route itself or to compare directions, prefix the command with DEV_PREVIEW_OK=1.',
      }
    : {
        additionalContext: 'Before you tell the operator the page is in the pane: (0) say only what board-browser.mjs printed about where it is. "in front of the chat the operator is looking at" means in front of them; a named other chat means they must click that chat in the sidebar; an error means it is not shown. A screenshot of the tab does not prove the pane shows it. (1) the tab board-browser.mjs just opened IS the pane\'s tab, even when chrome-devtools list_pages does not show it (find it in http://127.0.0.1:9222/json/list). Never close it as a stray tab; if the page needs a login, sign in that tab where it is (brand-tab.mjs adopt). (2) Screenshot that exact tab (CDP Page.captureScreenshot on its target id) and look at the image. If you cannot, tell the operator you could not confirm it.',
      }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...out } }))
  process.exit(0)
}

// Splits a simple command into words. Returns null for anything with shell operators,
// substitutions or variables outside quotes: those pass through untouched.
function words(text) {
  const out = []
  let word = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "'") {
      const end = text.indexOf("'", i + 1)
      if (end < 0) return null
      word = (word ?? '') + text.slice(i + 1, end)
      i = end
    } else if (c === '"') {
      let j = i + 1
      let part = ''
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === '\\' && j + 1 < text.length) part += text[++j]
        else if (text[j] === '$' || text[j] === '`') return null
        else part += text[j]
      }
      if (j >= text.length) return null
      word = (word ?? '') + part
      i = j
    } else if (c === '\\' && i + 1 < text.length) {
      word = (word ?? '') + text[++i]
    } else if (/\s/.test(c)) {
      if (word !== null) out.push({ text: word })
      word = null
    } else if (';&|<>()`$\n'.includes(c)) {
      return null
    } else {
      word = (word ?? '') + c
    }
  }
  if (word !== null) out.push({ text: word })
  return out
}

const parsed = words(cmd.trim())
if (!parsed || parsed[0]?.text !== 'open') process.exit(0)
const cwd = input.cwd || process.cwd()
const targets = []
for (const { text } of parsed.slice(1)) {
  if (text.startsWith('-')) {
    if (!PLAIN_FLAGS.has(text)) process.exit(0)
    continue
  }
  if (/^https?:\/\/\S+$/i.test(text)) {
    targets.push(text)
    continue
  }
  const path = text.replace(/^~(?=\/|$)/, homedir())
  const matches = /[*?[]/.test(path) ? globSync(path, { cwd }).map((m) => (isAbsolute(m) ? m : join(cwd, m))) : [resolve(cwd, path)]
  if (!matches.length) process.exit(0)
  for (const match of matches) {
    let stats
    try {
      stats = statSync(match)
    } catch {
      process.exit(0)
    }
    if (stats.isDirectory() ? BUNDLE.test(match) : !PANE.has(extname(match).slice(1).toLowerCase())) process.exit(0)
    targets.push(match)
  }
}
if (!targets.length) process.exit(0)

const board = join(homedir(), 'Library', 'Application Support', 'Session Board', 'browser-requests', 'board.pid')
try {
  process.kill(Number(readFileSync(board, 'utf8')), 0)
} catch {
  process.exit(0)
}

const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`
const note = typeof input.tool_input.description === 'string' ? input.tool_input.description : ''
const next = [join(homedir(), '.claude', 'bin', 'open-in-pane.sh'), '--note', note, ...targets].map(quote).join(' ')

try {
  const log = join(homedir(), '.claude', 'logs', 'open-to-pane.log')
  mkdirSync(dirname(log), { recursive: true })
  appendFileSync(log, `${new Date().toISOString()} ${input.session_id ?? ''}\n  before: ${cmd}\n  after:  ${next}\n`)
} catch {
  // the log is only for looking back
}
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...input.tool_input, command: next } } }))
