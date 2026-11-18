import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { openCodexRequestsSql, rule, sentMessageId, summarizeBackground, waitingText } from '../hooks/register'

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const TURN = { answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as const

const bash = { stdout: '', stderr: '', interrupted: false }

const stop = (types: string[]) => ({
  stop_hook_active: false,
  background_tasks: types.map(type => ({ id: `t-${type}`, type, status: 'running', description: type })),
})

test('rule spans the full width with the label centred', () => {
  const line = rule(40)
  expect(line).toHaveLength(40)
  expect(line).toBe('─'.repeat(13) + ' CLAUDE READY ' + '─'.repeat(13))
})

test('one orange line after a plain turn, green after a merge', async ($, on) => {
  on('tool.call', () => ({ result: bash }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.Stop', () => ({}))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.prompt.submit({ text: 'hi' } as never)
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.turn.complete(TURN)
    let ui = await $.ui.mount({ plugin: 'ready-banner', surface, ...BAND })
    const ready = await ui.findAll({ type: 'Text' })
    expect(ready).toHaveLength(1)
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain('#D97757')
    expect(drawn).toContain(rule(120))
    await ui.unmount()

    await $.prompt.submit({ text: 'merge it' } as never)
    await $.tool.call({ tool: 'Bash', command: '.claude/skills/pr-approve/scripts/gh-approve 123 --merge' })
    await $.turn.complete(TURN)
    ui = await $.ui.mount({ plugin: 'ready-banner', surface, ...BAND })
    expect(JSON.stringify(await ui.drawn())).toContain('#22C55E')
    await ui.unmount()

    await $.prompt.submit({ text: 'next' } as never)
    ui = await $.ui.mount({ plugin: 'ready-banner', surface, ...BAND })
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(0)
    await ui.unmount()
  }
})

test('AGENT WORKING while a background agent runs, CLAUDE READY once it finishes', async ($, on) => {
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.Stop', () => ({}))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)

  await $.prompt.submit({ text: 'fan out' } as never)
  await $.classic.Stop(stop(['subagent']) as never)
  await $.turn.complete(TURN)
  let ui = await $.ui.mount({ plugin: 'ready-banner', surface: 'terminal', ...BAND })
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('#3B82F6')
  expect(drawn).toContain(rule(120, ' AGENT WORKING '))
  await ui.unmount()

  // The agent's notification wakes the main loop, whose next Stop has nothing left.
  await $.classic.Stop(stop([]) as never)
  await $.turn.complete(TURN)
  ui = await $.ui.mount({ plugin: 'ready-banner', surface: 'terminal', ...BAND })
  expect(JSON.stringify(await ui.drawn())).toContain('#D97757')
  await ui.unmount()

  // Stop arriving after turn.complete counts too.
  await $.prompt.submit({ text: 'workflow' } as never)
  await $.turn.complete(TURN)
  await $.classic.Stop(stop(['workflow', 'subagent']) as never)
  ui = await $.ui.mount({ plugin: 'ready-banner', surface: 'terminal', ...BAND })
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain(rule(120, ' 2 AGENTS WORKING '))
  await ui.unmount()
})

test('background shells and monitors do not hold the banner back', async ($, on) => {
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.Stop', () => ({}))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)

  await $.prompt.submit({ text: 'serve' } as never)
  await $.classic.Stop(stop(['shell', 'monitor']) as never)
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ plugin: 'ready-banner', surface: 'terminal', ...BAND })
  expect(JSON.stringify(await ui.drawn())).toContain('#D97757')
})

test('gh pr merge --auto does not count as a merge', async ($, on) => {
  on('tool.call', () => ({ result: bash }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.Stop', () => ({}))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
  await $.prompt.submit({ text: 'queue' } as never)
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 5 --squash --auto' })
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ plugin: 'ready-banner', surface: 'terminal', ...BAND })
  expect(JSON.stringify(await ui.drawn())).toContain('#D97757')
})

const SENT = 'f2c5292c-4bb3-4db2-ad77-f6dc88a1ae30'

const sendResult = (target: string) => ({
  result: [{ type: 'text', text: JSON.stringify({ message: { id: SENT, target, sender: 'claude:me', status: 'queued' } }) }],
})

const codex = (open: () => boolean) => (on: Parameters<TestBody>[1]) => {
  on('tool.call', (_$, e) => (e.tool === 'Bash' ? { result: bash } : sendResult((e as never as { target: string }).target)) as never)
  on('process.run', (_$, e) =>
    ({
      value: { exitCode: 0, stdout: e.argv[0] === 'printenv' ? '/Users/x\n' : open() ? `${SENT}\n` : '', stderr: '' },
    }) as never,
  )
  on('clock.every', () => ({ value: undefined }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.Stop', () => ({}))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)
}

const SEND = 'mcp__agent_bridge__agent_bridge_send_message'

test('reads the message id out of the send result', () => {
  expect(sentMessageId(sendResult('codex:x').result)).toBe(SENT)
  expect(openCodexRequestsSql([SENT])).toContain(`m.id IN ('${SENT}')`)
})

test('blue CODEX WORKING while a sent request is open, orange once Codex answers', async ($, on) => {
  let open = true
  codex(() => open)(on)

  await $.prompt.submit({ text: 'hand to codex' } as never)
  await $.tool.call({ tool: SEND, target: 'codex:abc', sender: 'claude:me', text: 'do it' } as never)
  await $.classic.Stop(stop([]) as never)
  await $.turn.complete(TURN)
  let ui = await $.ui.mount({ plugin: 'ready-banner', surface: 'terminal', ...BAND })
  let drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('#3B82F6')
  expect(drawn).toContain(rule(120, ' CODEX WORKING '))
  await ui.unmount()

  open = false
  await $.classic.Stop(stop([]) as never)
  ui = await $.ui.mount({ plugin: 'ready-banner', surface: 'terminal', ...BAND })
  drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('#D97757')
  expect(drawn).toContain(rule(120))
})

test('a message to another Claude session does not count', async ($, on) => {
  codex(() => true)(on)

  await $.prompt.submit({ text: 'ping claude' } as never)
  await $.tool.call({ tool: SEND, target: 'claude:other', sender: 'claude:me', text: 'hi' } as never)
  await $.classic.Stop(stop([]) as never)
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ plugin: 'ready-banner', surface: 'terminal', ...BAND })
  expect(JSON.stringify(await ui.drawn())).toContain('#D97757')
})

test('a running agent and an open Codex request show together', async ($, on) => {
  codex(() => true)(on)

  await $.prompt.submit({ text: 'both' } as never)
  await $.tool.call({ tool: SEND, target: 'codex:abc', sender: 'claude:me', text: 'do it' } as never)
  await $.classic.Stop(stop(['subagent']) as never)
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ plugin: 'ready-banner', surface: 'terminal', ...BAND })
  expect(JSON.stringify(await ui.drawn())).toContain(rule(120, ' AGENT · CODEX WORKING '))
})

test('CI is a shell, monitor or one-shot wakeup watching checks; dev servers are not', () => {
  const shell = (command: string) => ({ type: 'shell', description: command, command })
  expect(summarizeBackground([shell('gh pr checks 6041 --watch')], [])).toEqual({ agents: 0, isCiRunning: true })
  expect(summarizeBackground([shell('.claude/skills/pr-approve/scripts/gh-approve 6041 --merge')], []).isCiRunning).toBe(true)
  expect(summarizeBackground([{ type: 'monitor', description: 'Watch CI on PR #6041' }], []).isCiRunning).toBe(true)
  expect(summarizeBackground([shell('npm run dev -- -p 3001')], []).isCiRunning).toBe(false)
  expect(summarizeBackground([], [{ prompt: 'check CI on #6041', recurring: false }]).isCiRunning).toBe(true)
  expect(summarizeBackground([], [{ prompt: 'check CI on #6041', recurring: true }]).isCiRunning).toBe(false)
  expect(waitingText(0, true, false)).toBe(' CI WORKING ')
  expect(waitingText(3, true, true)).toBe(' 3 AGENTS · CI · CODEX WORKING ')
})
