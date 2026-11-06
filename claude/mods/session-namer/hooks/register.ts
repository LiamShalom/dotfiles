import type { Engine, Register } from 'claude-code'

type Pane = { title: string; sessionId: string | null; name: string | null }
type Tab = { tab: Pane[]; ownNamed?: boolean }

export function cleanName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
}

async function readTab($: Engine, sessionId: string): Promise<Tab> {
  const ran = await $.process.run(['python3', `${$.plugin.root}/bin/tab-sessions.py`, sessionId], { timeoutMs: 10_000 })
  if (ran.exitCode !== 0) return { tab: [] }
  return JSON.parse(ran.stdout) as Tab
}

const SLACK_LINK = /https?:\/\/[\w.-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})(?:\?[^\s>)]*?thread_ts=(\d+\.\d+))?/

export function parseSlackLink(text: string) {
  const m = text.match(SLACK_LINK)
  if (!m) return null
  return { channelId: m[1], ts: `${m[2]}.${m[3]}`, threadTs: m[4] ?? null }
}

function mcpText(result: { content?: unknown }): string {
  const blocks = Array.isArray(result.content) ? (result.content as { type?: string; text?: string }[]) : []
  return blocks.map(b => (b.type === 'text' && b.text ? b.text : '')).join('\n')
}

// Finds the author of message `ts` in the detailed output of slack_read_thread.
export function senderOf(threadText: string, ts: string): string | null {
  for (const block of threadText.split(/\n(?====|---)/)) {
    if (!block.includes(`Message TS: ${ts}`)) continue
    const from = block.match(/From: ([^<(\n]+?)\s*[<(]/)?.[1]
    return from?.trim() || null
  }
  return null
}

// "#bugs drew", from the channel the linked Slack message is in and the person who wrote it.
async function slackOrigin($: Engine, prompt: string): Promise<string | null> {
  const link = parseSlackLink(prompt)
  if (!link) return null
  const [channel, thread] = await Promise.all([
    $.mcp.call('slack', 'slack_read_channel', { channel_id: link.channelId, limit: 1, response_format: 'concise' }),
    $.mcp.call('slack', 'slack_read_thread', {
      channel_id: link.channelId,
      message_ts: link.threadTs ?? link.ts,
      ...(link.threadTs ? { oldest: `${Number(link.ts.split('.')[0]) - 1}.000000`, limit: 5 } : { limit: 1 }),
    }),
  ])
  const channelName = channel.isError ? null : mcpText(channel).match(/Channel: #([\w.-]+)/)?.[1]
  const sender = thread.isError ? null : senderOf(mcpText(thread), link.ts)
  const firstName = sender?.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9-]/g, '')
  const parts = [channelName ? `#${channelName.toLowerCase()}` : null, firstName || null].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

async function chooseName($: Engine, prompt: string, panes: Pane[]) {
  const others = panes.filter(p => p.name).map(p => `- ${p.name}`).join('\n') || '(none)'
  const reply = await $.model.complete({
    model: 'haiku',
    maxTokens: 100,
    timeoutMs: 20_000,
    prompt:
      `The first message of a new coding session:\n<message>\n${prompt.slice(0, 4000)}\n</message>\n\n` +
      `Other sessions open beside it:\n${others}\n\n` +
      'If the message is about one specific brand, company or customer account, the name starts with ' +
      'that brand written as one word, then the topic (for example "livfresh payouts"). ' +
      'Otherwise the name is the topic. ' +
      'Reply with JSON only: {"name": "<one or two lowercase words>"}.',
  })
  if (!reply.isAnswered) return null
  const json = reply.text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  const parsed = JSON.parse(json) as { name?: string }
  return cleanName(parsed.name ?? '') || null
}

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    // A /clear counts as a user turn, so "no assistant reply yet" marks the first prompt.
    const isFirst =
      !e.text.trimStart().startsWith('/') && !(await $.session.messages()).some(m => m.role === 'assistant')
    if (isFirst) {
      const text = e.text
      $.clock.after(0, async () => {
        try {
          const sessionId = await $.session.id()
          const { tab, ownNamed } = await readTab($, sessionId)
          if (ownNamed) return
          const [name, origin] = await Promise.all([
            chooseName($, text, tab),
            slackOrigin($, text).catch(() => null),
          ])
          if (!name) return
          await $.command.run({ command: 'rename', args: origin ? `${origin} · ${name}` : name })
        } catch (err) {
          $.ui.log(`session-namer: ${err instanceof Error ? err.message : String(err)}`)
        }
      })
    }
    return next(e)
  })
}
