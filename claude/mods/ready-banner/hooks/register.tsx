import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BannerMode } from '../types'

const mode = atom({ plugin: 'ready-banner', key: 'mode' } as const, null as BannerMode)
const hasMerged = atom({ plugin: 'ready-banner', key: 'hasMerged' } as const, false)
const hasAnswered = atom({ plugin: 'ready-banner', key: 'hasAnswered' } as const, false)
const background = atom({ plugin: 'ready-banner', key: 'background' } as const, { agents: 0, isCiRunning: false })
const waitingLabel = atom({ plugin: 'ready-banner', key: 'waitingLabel' } as const, '')
const codexIds = atom({ plugin: 'ready-banner', key: 'codexIds' } as const, [] as string[])

const COLORS = { ready: '#D97757', merged: '#22C55E', waiting: '#3B82F6' } as const

const READY = ' CLAUDE READY '

// Long-lived shells and monitors (dev servers, log tails) are not agents; only the ones
// watching CI count, as CI.
const NOT_AGENTS: ReadonlySet<string> = new Set(['shell', 'monitor'])

const CI = /\bgh\s+(pr\s+checks|run\s+(watch|view))\b|\bgh-approve\b|\bCI\b/

type Task = { type: string; description: string; command?: string }

export const summarizeBackground = (
  tasks: readonly Task[],
  crons: readonly { prompt: string; recurring: boolean }[],
): { agents: number; isCiRunning: boolean } => ({
  agents: tasks.filter(task => !NOT_AGENTS.has(task.type)).length,
  isCiRunning:
    tasks.some(task => NOT_AGENTS.has(task.type) && CI.test(`${task.command ?? ''} ${task.description}`)) ||
    crons.some(cron => !cron.recurring && CI.test(cron.prompt)),
})

export const waitingText = (agents: number, isCiRunning: boolean, isCodexWorking: boolean): string => {
  const parts = [
    agents === 1 ? 'AGENT' : agents > 1 ? `${agents} AGENTS` : '',
    isCiRunning ? 'CI' : '',
    isCodexWorking ? 'CODEX' : '',
  ].filter(Boolean)

  return parts.length === 0 ? '' : ` ${parts.join(' · ')} WORKING `
}

// `gh pr merge --auto` only queues the merge, so it does not count.
const MERGE = /\bgh\s+pr\s+merge\b(?![^|;&]*--auto)|\bgh-approve\b[^|;&]*--merge\b/

const BRIDGE_DB = '.local/share/agent-bridge/bridge.sqlite3'

const CODEX_POLL_MS = 10_000

// A request Codex never acknowledged would otherwise pin the banner on CODEX WORKING forever.
const CODEX_MAX_AGE_S = 6 * 60 * 60

export const isMergeCommand = (command: string): boolean => MERGE.test(command)

export const rule = (columns: number, label: string = READY): string => {
  const dashes = Math.max(columns - label.length, 6)
  const left = Math.floor(dashes / 2)

  return '─'.repeat(left) + label + '─'.repeat(dashes - left)
}

const SEND_TOOL = 'mcp__agent_bridge__agent_bridge_send_message'

// The send result is the stored message, whose own id comes first.
const SENT_ID = /id\\*"\s*:\s*\\*"([0-9a-f-]{36})/

export const sentMessageId = (result: unknown): string | undefined =>
  SENT_ID.exec(JSON.stringify(result) ?? '')?.[1]

// Still open = not finished, failed or cancelled, and the Codex session has not written back since.
export const openCodexRequestsSql = (ids: readonly string[]): string =>
  `SELECT m.id FROM messages m
WHERE m.id IN (${ids.map(id => `'${id}'`).join(',')})
AND m.status IN ('queued','presented','received','working')
AND m.created_at > strftime('%s','now') - ${CODEX_MAX_AGE_S}
AND NOT EXISTS (SELECT 1 FROM messages r
  WHERE r.sender = m.target AND r.target = m.sender AND r.created_at > m.created_at);`

const isWaitingOnCodex = async ($: EngineInterface): Promise<boolean> => {
  const ids = await read($, codexIds)

  if (ids.length === 0) {
    return false
  }

  try {
    const home = (await $.process.run(['printenv', 'HOME'])).stdout.trim()
    const ran = await $.process.run(['sqlite3', `${home}/${BRIDGE_DB}`, openCodexRequestsSql(ids)], {
      timeoutMs: 5000,
    })

    if (ran.exitCode !== 0) {
      return false
    }

    const open = ran.stdout.split('\n').filter(id => ids.includes(id))
    await update($, codexIds, () => open)

    return open.length > 0
  } catch {
    return false
  }
}

let codexPoll: { cancel: () => void } | undefined

const stopCodexPoll = (): void => {
  codexPoll?.cancel()
  codexPoll = undefined
}

const refresh = async ($: EngineInterface): Promise<void> => {
  if (!(await read($, hasAnswered))) {
    return
  }

  const { agents, isCiRunning } = await read($, background)
  const isCodexWorking = await isWaitingOnCodex($)

  if (isCodexWorking) {
    codexPoll ??= $.clock.every(CODEX_POLL_MS, () => void refresh($))
  } else {
    stopCodexPoll()
  }

  const label = waitingText(agents, isCiRunning, isCodexWorking)

  if (label !== '') {
    await update($, waitingLabel, () => label)
    await update($, mode, () => 'waiting')

    return
  }

  const merged = await read($, hasMerged)
  await update($, mode, () => (merged ? 'merged' : 'ready'))
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    stopCodexPoll()
    await update($, mode, () => null)
    await update($, hasMerged, () => false)
    await update($, hasAnswered, () => false)
    await update($, background, () => ({ agents: 0, isCiRunning: false }))

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const hasSucceeded = ran.deny === undefined && ran.isError !== true

    if (hasSucceeded && isMergeCommand(e.command)) {
      await update($, hasMerged, () => true)
    }

    return ran
  })

  on('tool.call', { tool: SEND_TOOL }, async ($, e, next) => {
    const ran = await next(e)
    const target = (e as { target?: unknown }).target
    const id = ran.deny === undefined && ran.isError !== true ? sentMessageId(ran.result) : undefined

    if (id !== undefined && typeof target === 'string' && target.startsWith('codex:')) {
      await update($, codexIds, ids => [...ids, id])
    }

    return ran
  })

  // The main loop's Stop lists the background work still in flight; a finishing agent wakes
  // the main loop, so the next Stop carries the shorter list.
  on('classic.Stop', async ($, e, next) => {
    await update($, background, () => summarizeBackground(e.background_tasks ?? [], e.session_crons ?? []))
    await refresh($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') {
      await update($, hasAnswered, () => true)
      await refresh($)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, mode)

    if (current === null || e.props.isWorking || e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const label = current === 'waiting' ? await read($, waitingLabel) : READY

    return (
      <Box key="banner">
        <Text color={COLORS[current]} bold wrap="truncate">
          {rule(e.props.bodyColumns, label)}
        </Text>
      </Box>
    )
  })
}
