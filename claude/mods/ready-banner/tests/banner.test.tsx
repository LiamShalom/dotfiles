import { expect, test } from 'claude-code/testing'

import { rule } from '../hooks/register'

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

test('hidden while a background agent runs, shown once it finishes', async ($, on) => {
  on('prompt.submit', (_$, e) => ({ text: e.text }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.Stop', () => ({}))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }) as never)

  await $.prompt.submit({ text: 'fan out' } as never)
  await $.classic.Stop(stop(['subagent']) as never)
  await $.turn.complete(TURN)
  let ui = await $.ui.mount({ plugin: 'ready-banner', surface: 'terminal', ...BAND })
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(0)
  await ui.unmount()

  // The agent's notification wakes the main loop, whose next Stop has nothing left.
  await $.classic.Stop(stop([]) as never)
  await $.turn.complete(TURN)
  ui = await $.ui.mount({ plugin: 'ready-banner', surface: 'terminal', ...BAND })
  expect(JSON.stringify(await ui.drawn())).toContain('#D97757')
  await ui.unmount()

  // Stop arriving after turn.complete hides it too.
  await $.prompt.submit({ text: 'workflow' } as never)
  await $.turn.complete(TURN)
  await $.classic.Stop(stop(['workflow']) as never)
  ui = await $.ui.mount({ plugin: 'ready-banner', surface: 'terminal', ...BAND })
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(0)
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
