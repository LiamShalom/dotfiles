import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { cleanName, parseSlackLink, pickColor, senderOf } from './register'

const pane = (name: string | null, color: string | null) => ({ title: name ?? 'zsh', sessionId: name, name, color })

const CLEAR = { role: 'user', text: '<command-name>/clear</command-name>', toolUses: [] }
const REPLY = { role: 'assistant', text: 'done', toolUses: [] }

function engine(on: On, history: object[], tab: object, reply: string) {
  const commands: string[] = []
  on('session.messages', () => ({ value: history }))
  on('session.id', () => ({ value: 'S1' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(tab), stderr: '' } }))
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: reply,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  on('command.run', (_$, e) => {
    commands.push(`/${e.command} ${e.args}`)
    return { text: '' }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  return commands
}

test('cleanName keeps at most two lowercase words', () => {
  expect(cleanName('Payout Fix For Agencies!')).toBe('payout fix')
  expect(cleanName('  ')).toBe('')
})

test('pickColor reuses a related session color, else the first free one', () => {
  const tab = [pane('payouts', 'red'), pane('ads', 'blue'), pane(null, null)]
  expect(pickColor(tab, 'Payouts')).toBe('red')
  expect(pickColor(tab, null)).toBe('green')
  expect(pickColor(tab, 'unknown')).toBe('green')
})

test('pickColor falls back to the least used color when all are taken', () => {
  const all = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan', 'red'].map((c, i) => pane(`s${i}`, c))
  expect(pickColor(all, null)).toBe('blue')
})

test('first prompt renames and colors the session', async ($, on) => {
  const clock = mock.clock(on)
  const tab = { tab: [pane('payouts', 'red'), pane('ads', 'blue')] }
  const commands = engine(on, [], tab, '{"name": "Wallet Gate", "related": null}')
  await $.prompt.submit({ text: 'fix the wallet funding gate' })
  await clock.advance(0)
  expect(commands).toEqual(['/rename wallet gate', '/color green'])
})

test('a related session shares its color', async ($, on) => {
  const clock = mock.clock(on)
  const tab = { tab: [pane('payouts', 'red'), pane('ads', 'blue')] }
  const commands = engine(on, [], tab, '{"name": "payout copy", "related": "payouts"}')
  await $.prompt.submit({ text: 'change the payouts page copy' })
  await clock.advance(0)
  expect(commands).toEqual(['/rename payout copy', '/color red'])
})

test('later prompts and slash commands are left alone', async ($, on) => {
  const clock = mock.clock(on)
  const commands = engine(on, [CLEAR, REPLY], { tab: [] }, '{"name": "x", "related": null}')
  await $.prompt.submit({ text: 'keep going' })
  await clock.advance(0)
  expect(commands).toEqual([])
})

test('the first prompt after /clear still renames the session', async ($, on) => {
  const clock = mock.clock(on)
  const commands = engine(on, [CLEAR], { tab: [] }, '{"name": "announcements", "related": null}')
  await $.prompt.submit({ text: 'send the creator announcement' })
  await clock.advance(0)
  expect(commands).toEqual(['/rename announcements', '/color red'])
})

test('a session the person already named keeps its name and color', async ($, on) => {
  const clock = mock.clock(on)
  const commands = engine(on, [], { tab: [], ownNamed: true }, '{"name": "x", "related": null}')
  await $.prompt.submit({ text: 'fix the livfresh payouts page' })
  await clock.advance(0)
  expect(commands).toEqual([])
})

const THREAD = `=== THREAD PARENT MESSAGE ===
From: Jadon Davis <jadon@sideshift.app> (U0AN5843W3C)
Time: 2026-10-26 15:22:00 EDT
Message TS: 1793042520.539289
I am in an interview.

=== THREAD REPLIES (3 total) ===

--- Reply 3 of 3 ---
From: Gul <gul@infinitegrowthugc.com> (U0CCBKWSRPB, external: Infinitegrowthugc)
Time: 2026-10-26 15:36:23 EDT
Message TS: 1793043383.656429
no worries!`

test('parseSlackLink reads a message link and a thread reply link', () => {
  expect(parseSlackLink('see https://sideshift.slack.com/archives/C069EE95RJP/p1781703051675299 pls')).toEqual({
    channelId: 'C069EE95RJP',
    ts: '1781703051.675299',
    threadTs: null,
  })
  expect(
    parseSlackLink(
      'https://sideshift.enterprise.slack.com/archives/C0CCDCTLEHJ/p1793043383656429?thread_ts=1793042520.539289&cid=C0CCDCTLEHJ',
    ),
  ).toEqual({ channelId: 'C0CCDCTLEHJ', ts: '1793043383.656429', threadTs: '1793042520.539289' })
  expect(parseSlackLink('fix the wallet gate')).toBe(null)
})

test('senderOf finds the author of the linked message, not the thread parent', () => {
  expect(senderOf(THREAD, '1793043383.656429')).toBe('Gul')
  expect(senderOf(THREAD, '1793042520.539289')).toBe('Jadon Davis')
  expect(senderOf(THREAD, '1.1')).toBe(null)
})

test('a Slack link names the session after its channel and sender', async ($, on) => {
  const clock = mock.clock(on)
  const commands = engine(on, [], { tab: [] }, '{"name": "creator questions", "related": null}')
  on('mcp.call', (_$, e) => ({
    value: {
      isError: false,
      content: [
        {
          type: 'text',
          text: e.tool === 'slack_read_channel' ? 'Channel: #sideshift-infinite (C0CCDCTLEHJ)\n\n' : THREAD,
        },
      ],
    },
  }))
  await $.prompt.submit({
    text: 'look into https://sideshift.slack.com/archives/C0CCDCTLEHJ/p1793043383656429?thread_ts=1793042520.539289',
  })
  await clock.advance(0)
  expect(commands).toEqual(['/rename #sideshift-infinite gul · creator questions', '/color red'])
})

test('a failed Slack lookup falls back to the topic name', async ($, on) => {
  const clock = mock.clock(on)
  const commands = engine(on, [], { tab: [] }, '{"name": "creator questions", "related": null}')
  on('mcp.call', () => ({ value: { isError: true, content: [] } }))
  await $.prompt.submit({ text: 'https://sideshift.slack.com/archives/C0CCDCTLEHJ/p1793043383656429' })
  await clock.advance(0)
  expect(commands).toEqual(['/rename creator questions', '/color red'])
})
