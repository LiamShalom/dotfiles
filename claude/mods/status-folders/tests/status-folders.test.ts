import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

type Sidebar = {
  sections: { id: string; kind: string; name: string }[]
  self: { pinned?: boolean; group: { id: string; name: string } | null }
  moves: string[]
  created: string[]
}

type Serve = {
  onAsk?: () => Promise<void> | void
  // Holds every sidebar call until it resolves.
  gate?: Promise<void>
  fail?: 'throw' | 'deny'
}

function sidebar(group: string | null, opts: { pinned?: boolean; folders?: string[] } = {}): Sidebar {
  const names = opts.folders ?? ['Saved for later', 'Needs you', 'Working']
  const sections = names.map(name => ({ id: `id-${name}`, kind: 'manual', name }))
  return {
    sections,
    self: { pinned: opts.pinned, group: group === null ? null : { id: `id-${group}`, name: group } },
    moves: [],
    created: [],
  }
}

function deferred() {
  let release = () => {}
  const promise = new Promise<void>(resolve => {
    release = resolve
  })
  return { promise, release }
}

// The test runtime has setTimeout; the hooks types leave it undeclared.
declare function setTimeout(callback: (value: unknown) => void, ms: number): unknown

// Lets moves the hooks queued without awaiting run to the end.
async function settle() {
  for (let i = 0; i < 20; i += 1) await new Promise(resolve => setTimeout(resolve, 0))
}

const ANSWER = { result: { answers: { q: 'yes' } } } as never

// Stands in for the desktop app's sidebar tools, beneath the plugin.
function serve(on: On, s: Sidebar, opts: Serve = {}) {
  on('tool.call', async ($, e) => {
    const args = e as unknown as Record<string, unknown>
    const answer = (value: unknown) => ({ result: {}, text: typeof value === 'string' ? value : JSON.stringify(value) })
    if (e.tool === 'AskUserQuestion') {
      await opts.onAsk?.()
      return ANSWER
    }
    if (e.tool.startsWith('mcp__ccd_')) {
      await opts.gate
      if (opts.fail === 'throw') throw new Error('sidebar is down')
      if (opts.fail === 'deny') return { deny: 'no sidebar here' }
    }
    // The desktop app's tools are not in the generated tool names, so compare as a plain string.
    const tool: string = e.tool
    switch (tool) {
      case 'mcp__ccd_session_mgmt__get_session':
        return answer(s.self)
      case 'mcp__ccd_sidebar__list_sections':
        return answer(s.sections)
      case 'mcp__ccd_sidebar__create_section': {
        const made = { id: `id-${String(args.name)}`, kind: 'manual', name: String(args.name) }
        s.sections.push(made)
        s.created.push(made.name)
        return answer(made)
      }
      case 'mcp__ccd_sidebar__move_sessions': {
        const target = s.sections.find(x => x.id === args.section_id)
        if (!target) return { result: {}, text: 'no such section', isError: true as const }
        s.self.group = { id: target.id, name: target.name }
        s.moves.push(target.name)
        return answer('Moved 1 session(s) to the section.')
      }
      default:
        return { result: {} }
    }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
}

const end = (reason: 'answer' | 'aborted' | 'error', extra: { agentId?: string } = {}) => ({
  answer: 'done',
  durationMs: 1,
  isAborted: reason === 'aborted',
  turnId: 't1',
  reason,
  ...extra,
})

test('a turn files an ungrouped session under Working, then Needs you', async ($, on) => {
  const s = sidebar(null)
  serve(on, s)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await settle()
  expect(s.moves).toEqual(['Working'])
  await $.turn.complete(end('answer'))
  await settle()
  expect(s.moves).toEqual(['Working', 'Needs you'])
})

for (const reason of ['aborted', 'error'] as const) {
  test(`a turn that ends by ${reason} still ends in Needs you`, async ($, on) => {
    const s = sidebar('Working')
    serve(on, s)
    await $.turn.complete(end(reason))
    await settle()
    expect(s.moves).toEqual(['Needs you'])
  })
}

test('a refused turn still ends in Needs you', async ($, on) => {
  const s = sidebar('Working')
  serve(on, s)
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'refusal',
    refusal: { category: null, explanation: null },
  })
  await settle()
  expect(s.moves).toEqual(['Needs you'])
})

test('a question to the person moves the session to Needs you while it waits', async ($, on) => {
  const s = sidebar('Working')
  const gate = deferred()
  const seen: (string | undefined)[] = []
  serve(on, s, {
    onAsk: async () => {
      await settle()
      seen.push(s.self.group?.name)
      await gate.promise
    },
  })
  const asked = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await settle()
  gate.release()
  expect(await asked).toEqual(ANSWER)
  await settle()
  expect(seen).toEqual(['Needs you'])
  expect(s.self.group?.name).toBe('Working')
})

test('a question interrupted with its turn leaves the session in Needs you', async ($, on) => {
  const s = sidebar('Working')
  const gate = deferred()
  serve(on, s, { onAsk: () => gate.promise })
  const asked = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await settle()
  await $.turn.complete(end('aborted'))
  gate.release()
  await asked
  await settle()
  expect(s.self.group?.name).toBe('Needs you')
})

test('a hung sidebar holds up neither a turn nor a question', async ($, on) => {
  const s = sidebar(null)
  const gate = deferred()
  serve(on, s, { gate: gate.promise })
  const started = await $.turn.start({ text: 'hi', turnId: 't1' })
  expect(started.turnId).toBe('t1')
  expect(await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)).toEqual(ANSWER)
  const done = await $.turn.complete(end('answer'))
  expect(done.text).toBe('done')
  expect(s.moves).toEqual([])
  gate.release()
  await settle()
  expect(s.self.group?.name).toBe('Needs you')
})

test('a sidebar call that never answers gives up, and later moves still run', async ($, on) => {
  const clock = mock.clock(on)
  const s = sidebar(null)
  let calls = 0
  // The first sidebar call never answers; every later one does.
  on('tool.call', { tool: 'mcp__ccd_session_mgmt__get_session' } as never, (_, e, next) => {
    calls += 1
    return calls === 1 ? new Promise(() => {}) : next(e)
  })
  serve(on, s)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await clock.settle()
  expect(s.moves).toEqual([])
  await $.turn.complete(end('answer'))
  await clock.advance(15_000)
  await clock.settle()
  expect(s.moves).toEqual(['Needs you'])
})

for (const fail of ['throw', 'deny'] as const) {
  test(`a sidebar that fails (${fail}) breaks no turn and no question`, async ($, on) => {
    const s = sidebar(null)
    serve(on, s, { fail })
    expect((await $.turn.start({ text: 'hi', turnId: 't1' })).turnId).toBe('t1')
    expect(await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)).toEqual(ANSWER)
    expect((await $.turn.complete(end('answer'))).text).toBe('done')
    await settle()
    expect(s.moves).toEqual([])
  })
}

test('a session already in the right folder is not moved', async ($, on) => {
  const s = sidebar('Working')
  serve(on, s)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await settle()
  expect(s.moves).toEqual([])
})

test('a pinned session is left alone', async ($, on) => {
  const s = sidebar(null, { pinned: true })
  serve(on, s)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await $.turn.complete(end('answer'))
  await settle()
  expect(s.moves).toEqual([])
})

test('a session the person filed in another folder is left alone', async ($, on) => {
  const s = sidebar('Saved for later')
  serve(on, s)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await $.turn.complete(end('answer'))
  await settle()
  expect(s.moves).toEqual([])
  expect(s.self.group?.name).toBe('Saved for later')
})

test('a subagent never moves the session', async ($, on) => {
  const s = sidebar('Needs you')
  serve(on, s)
  await $.turn.start({ text: 'hi', turnId: 't2', agentId: 'a1' })
  await $.tool.call({ tool: 'AskUserQuestion', questions: [], agentId: 'a1' } as never)
  await $.turn.complete(end('answer', { agentId: 'a1' }))
  await settle()
  expect(s.moves).toEqual([])
})

test('a missing folder is created before the move', async ($, on) => {
  const s = sidebar(null, { folders: ['Saved for later'] })
  serve(on, s)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await settle()
  expect(s.created).toEqual(['Working'])
  expect(s.moves).toEqual(['Working'])
})
