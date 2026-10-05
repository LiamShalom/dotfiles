import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BannerMode } from '../types'

const mode = atom({ plugin: 'ready-banner', key: 'mode' } as const, null as BannerMode)
const hasMerged = atom({ plugin: 'ready-banner', key: 'hasMerged' } as const, false)
const hasAnswered = atom({ plugin: 'ready-banner', key: 'hasAnswered' } as const, false)
const isWaiting = atom({ plugin: 'ready-banner', key: 'isWaiting' } as const, false)

const COLORS = { ready: '#D97757', merged: '#22C55E' } as const

const LABEL = ' CLAUDE READY '

// Long-lived shells and monitors (dev servers, log tails) would hold the banner back forever.
const NOT_AGENTS: ReadonlySet<string> = new Set(['shell', 'monitor'])

// `gh pr merge --auto` only queues the merge, so it does not count.
const MERGE = /\bgh\s+pr\s+merge\b(?![^|;&]*--auto)|\bgh-approve\b[^|;&]*--merge\b/

export const isMergeCommand = (command: string): boolean => MERGE.test(command)

export const rule = (columns: number): string => {
  const dashes = Math.max(columns - LABEL.length, 6)
  const left = Math.floor(dashes / 2)

  return '─'.repeat(left) + LABEL + '─'.repeat(dashes - left)
}

const refresh = async ($: EngineInterface): Promise<void> => {
  if (!(await read($, hasAnswered))) {
    return
  }

  const waiting = await read($, isWaiting)
  const merged = await read($, hasMerged)

  await update($, mode, () => (waiting ? null : merged ? 'merged' : 'ready'))
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    await update($, mode, () => null)
    await update($, hasMerged, () => false)
    await update($, hasAnswered, () => false)
    await update($, isWaiting, () => false)

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

  // The main loop's Stop lists the background work still in flight; a finishing agent wakes
  // the main loop, so the next Stop carries the shorter list.
  on('classic.Stop', async ($, e, next) => {
    const tasks = e.background_tasks ?? []

    await update($, isWaiting, () => tasks.some(task => !NOT_AGENTS.has(task.type)))
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

    return (
      <Box key="banner">
        <Text color={COLORS[current]} bold wrap="truncate">
          {rule(e.props.bodyColumns)}
        </Text>
      </Box>
    )
  })
}
