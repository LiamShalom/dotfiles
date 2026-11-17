#!/usr/bin/env node
// One evidence pack for a production incident, in 10-minute buckets: the alert channels, the primary
// database's CPU and connections, its top queries by execution time (Query Insights, with text), DDL
// or backend kills someone ran by hand, and the PRs merged in the window. Read-only.
//   incident-snapshot.mjs [--at <ISO time>] [--before <minutes>] [--after <minutes>]
// Defaults: --at now, 60 minutes before, 120 after (never past now).
// Built after the 2026-11-16 outage, where an unindexed query held the pooler for 85 minutes and a
// triage run reported the symptom (a webhook spike) instead of the query.
import { execFileSync } from 'node:child_process'

const PROJECT = 'sideshift-d84ee'
const INSTANCE = 'sideshift-d84ee:sideshift-sql-east4'
const REPO = 'SideShiftApp/sideshift-monorepo'
const ALERT_CHANNELS = { C0B96GSUHDZ: '#database-alerts', C0CEJUY1YDD: '#prod-alerts' }
const BUCKET_S = 600

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const at = new Date(arg('at', new Date().toISOString()))
if (Number.isNaN(at.getTime())) { console.error('incident-snapshot: --at is not a time'); process.exit(2) }
const start = new Date(at.getTime() - Number(arg('before', 60)) * 60_000)
const end = new Date(Math.min(Date.now(), at.getTime() + Number(arg('after', 120)) * 60_000))
const hhmm = (iso) => iso.slice(11, 16)

let gtoken
const googleToken = () => (gtoken ??= execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', timeout: 60_000 }).trim())

async function series(filter, { aligner = 'ALIGN_MEAN', reducer, groupBy = [] } = {}) {
  const q = new URLSearchParams({
    filter, 'interval.startTime': start.toISOString(), 'interval.endTime': end.toISOString(),
    'aggregation.alignmentPeriod': `${BUCKET_S}s`, 'aggregation.perSeriesAligner': aligner,
  })
  if (reducer) q.set('aggregation.crossSeriesReducer', reducer)
  for (const g of groupBy) q.append('aggregation.groupByFields', g)
  const r = await fetch(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?${q}`, {
    headers: { authorization: `Bearer ${googleToken()}` }, signal: AbortSignal.timeout(90_000),
  })
  const json = await r.json()
  if (!r.ok) throw new Error(json.error?.message ?? `HTTP ${r.status}`)
  return json.timeSeries ?? []
}
const value = (p) => p.value.doubleValue ?? Number(p.value.int64Value ?? 0)
const points = (s, scale = 1) => Object.fromEntries(s.points.map((p) => [p.interval.endTime, Math.round(value(p) * scale * 10) / 10]))
const row = (pts) => Object.keys(pts).sort().map((k) => `${hhmm(k)} ${pts[k]}`).join(' · ')

const sections = []
async function section(title, fn) {
  try { sections.push(`## ${title}\n${(await fn()) || '(nothing in the window)'}`) }
  catch (error) { sections.push(`## ${title}\nunavailable: ${String(error.message ?? error).slice(0, 200)}`) }
}

await section('Alert channels', async () => {
  const token = execFileSync('security', ['find-generic-password', '-s', 'claude-slack-user-token', '-w'], { encoding: 'utf8', timeout: 10_000 }).trim()
  const lines = []
  for (const [id, name] of Object.entries(ALERT_CHANNELS)) {
    const r = await fetch('https://slack.com/api/conversations.history', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ channel: id, oldest: String(start.getTime() / 1000), latest: String(end.getTime() / 1000), limit: '200' }),
      signal: AbortSignal.timeout(20_000),
    })
    const json = await r.json()
    if (!json.ok) { lines.push(`${name}: ${json.error}`); continue }
    for (const m of [...json.messages].reverse()) {
      const parts = [m.text, ...(m.attachments ?? []).flatMap((a) => [a.title, a.text]),
        ...(m.blocks ?? []).flatMap((b) => [b.text?.text, ...(b.elements ?? []).flatMap((e) => e.elements?.map((x) => x.text) ?? [e.text])])]
      const text = parts.filter((t) => typeof t === 'string').join(' ').split(/\*Documentation\*/)[0]
        .replace(/<https?:[^|>]+\|([^>]+)>/g, '$1').replace(/https?:\S+/g, '').replace(/\s+/g, ' ').trim()
      if (text) lines.push(`- ${new Date(Number(m.ts) * 1000).toISOString().slice(11, 19)} ${name}: ${text.slice(0, 260)}`)
    }
  }
  const MAX = 40
  return (lines.length > MAX ? [...lines.slice(0, MAX), `- … ${lines.length - MAX} more`] : lines).join('\n')
})

await section('Primary database (10-minute means)', async () => {
  const db = `resource.labels.database_id="${INSTANCE}"`
  const [cpu] = await series(`metric.type="cloudsql.googleapis.com/database/cpu/utilization" AND ${db}`)
  const [conns] = await series(`metric.type="cloudsql.googleapis.com/database/postgresql/num_backends" AND ${db}`, { reducer: 'REDUCE_SUM' })
  return [cpu && `CPU %: ${row(points(cpu, 100))}`, conns && `Backends: ${row(points(conns))}`].filter(Boolean).join('\n')
})

await section('Top queries by execution time (Query Insights, seconds per second)', async () => {
  const rows = await series(`metric.type="cloudsql.googleapis.com/database/postgresql/insights/perquery/execution_time" AND resource.labels.resource_id="${INSTANCE}"`,
    { aligner: 'ALIGN_RATE', reducer: 'REDUCE_SUM', groupBy: ['metric.labels.query_hash', 'metric.labels.querystring'] })
  return rows.map((s) => ({ s, pts: points(s, 1e-6) }))
    .map((x) => ({ ...x, peak: Math.max(...Object.values(x.pts)) })).sort((a, b) => b.peak - a.peak).slice(0, 8)
    .map(({ s, pts, peak }) => `- hash ${s.metric.labels.query_hash} (peak ${peak} s/s): ${row(pts)}\n  ${String(s.metric.labels.querystring ?? '').replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n')
})

await section('Statements run by hand on the primary (DDL, VACUUM, backend kills)', async () => {
  const filter = `resource.type="cloudsql_database" AND resource.labels.database_id="${INSTANCE}" AND timestamp>="${start.toISOString()}" AND timestamp<="${end.toISOString()}" AND textPayload=~"STATEMENT:\\s+(CREATE|DROP|ALTER|REINDEX|VACUUM|ANALYZE)|pg_terminate_backend|pg_cancel_backend" AND NOT textPayload:"Query Text"`
  const out = execFileSync('gcloud', ['logging', 'read', filter, `--project=${PROJECT}`, '--limit=200', '--order=asc', '--format=json'], { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 << 20 })
  const seen = new Map()
  for (const e of JSON.parse(out)) {
    const m = /user=([^,]+),host=(\S+).*?STATEMENT:\s+(.*)$/s.exec(e.textPayload ?? '')
    const key = (m?.[3] ?? e.textPayload).replace(/\s+/g, ' ').slice(0, 240)
    if (!seen.has(key)) seen.set(key, `- ${e.timestamp.slice(11, 19)} ${m ? `${m[1]}@${m[2]}` : ''}: ${key}`)
  }
  return [...seen.values()].join('\n')
})

await section('PRs merged in the window', async () => {
  const out = execFileSync('gh', ['pr', 'list', '-R', REPO, '--state', 'merged', '--limit', '60', '--search', `merged:${start.toISOString().slice(0, 19)}Z..${end.toISOString().slice(0, 19)}Z`,
    '--json', 'number,title,mergedAt,author'], { encoding: 'utf8', timeout: 60_000 })
  return JSON.parse(out).sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))
    .map((p) => `- ${p.mergedAt.slice(11, 19)} #${p.number} ${p.author.login}: ${p.title}`).join('\n')
})

console.log(`# Incident snapshot ${start.toISOString()} → ${end.toISOString()} (UTC)\n\n${sections.join('\n\n')}`)
