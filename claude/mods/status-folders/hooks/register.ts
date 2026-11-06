import type { EngineInterface, Register } from 'claude-code'

const WORKING = 'Working'
const NEEDS_YOU = 'Needs you'
const OURS = new Set([WORKING, NEEDS_YOU])
const MOVE_TIMEOUT_MS = 15_000

type Folder = typeof WORKING | typeof NEEDS_YOU
type Section = { id: string; kind: string; name: string }
type Session = { pinned?: boolean; group?: { id: string; name: string } | null }

// Moves run one after another, so the folder a session ends in is the last one asked for.
let queue: Promise<void> = Promise.resolve()
// Counts main-loop turn ends, so a question answered after its turn ended is not filed back under Working.
let turnEnds = 0

async function call($: EngineInterface, input: Record<string, unknown> & { tool: string }) {
  const ran = await $.tool.call(input as Parameters<EngineInterface['tool']['call']>[0])
  if (ran.deny !== undefined) throw new Error(`${input.tool} refused: ${ran.deny}`)
  if (ran.isError) throw new Error(`${input.tool} failed: ${ran.text ?? ''}`)
  return ran.text ?? ''
}

async function folderId($: EngineInterface, name: Folder) {
  const sections = JSON.parse(await call($, { tool: 'mcp__ccd_sidebar__list_sections' })) as Section[]
  const found = sections.find(s => s.kind === 'manual' && s.name === name)
  if (found) return found.id
  const made = JSON.parse(
    await call($, { tool: 'mcp__ccd_sidebar__create_section', name }),
  ) as Section
  return made.id
}

async function move($: EngineInterface, name: Folder) {
  const self = JSON.parse(
    await call($, { tool: 'mcp__ccd_session_mgmt__get_session', session_id: 'self' }),
  ) as Session
  // A pin or a folder the person chose is theirs: moving into a folder would unpin it.
  if (self.pinned === true) return
  if (self.group && !OURS.has(self.group.name)) return
  if (self.group?.name === name) return
  const sectionId = await folderId($, name)
  await call($, { tool: 'mcp__ccd_sidebar__move_sessions', session_ids: ['self'], section_id: sectionId })
}

// A sidebar call that never answers must not stall every later move.
async function moveWithin($: EngineInterface, name: Folder) {
  const timer = new AbortController()
  const timeout = $.clock.sleep(MOVE_TIMEOUT_MS, { signal: timer.signal }).then(() => {
    throw new Error(`timed out after ${MOVE_TIMEOUT_MS} ms`)
  })
  timeout.catch(() => {})
  try {
    await Promise.race([move($, name), timeout])
  } finally {
    timer.abort()
  }
}

function fileUnder($: EngineInterface, name: Folder) {
  queue = queue
    .then(() => moveWithin($, name))
    .catch((error: unknown) => {
      $.ui.log(`status-folders: could not move this session to ${name}: ${String(error)}`, { to: 'debug' })
    })
}

// Hooks never await a move: a slow sidebar must not hold up a turn or a question.
export const register: Register = on => {
  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) fileUnder($, WORKING)
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      turnEnds += 1
      fileUnder($, NEEDS_YOU)
    }
    return next(e)
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const endsBefore = turnEnds
    fileUnder($, NEEDS_YOU)
    try {
      return await next(e)
    } finally {
      if (turnEnds === endsBefore && !next.signal.aborted) fileUnder($, WORKING)
    }
  }).catch(($, e, next) => next(e))
}
