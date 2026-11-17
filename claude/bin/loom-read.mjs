#!/usr/bin/env node
// Read a Loom video as text: title, length, Loom's AI summary and the spoken transcript.
// The share page is a JS app, so WebFetch/curl of it shows no video; these are the public
// endpoints the page itself calls. Works for any video the link lets a signed-out viewer watch.
//
//   loom-read <loom url>            prints the text
//   loom-read <loom url> --video f  also saves the mp4 to f (to pull frames with ffmpeg)
import { writeFileSync } from 'node:fs'

export const loomIds = (text) => [...new Set([...String(text ?? '').matchAll(/loom\.com\/(?:share|embed)\/([0-9a-f]{32})/gi)].map((m) => m[1].toLowerCase()))]

const getJson = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`${new URL(url).pathname} answered ${res.status}`)
  return res.json()
}

// "00:00:01.000 --> 00:00:04.000\nWords" cues → one paragraph of speech with [m:ss] marks.
export const vttToText = (vtt) => String(vtt).split(/\r?\n\r?\n/).map((cue) => {
  const lines = cue.split(/\r?\n/)
  const at = lines.findIndex((l) => l.includes('-->'))
  if (at < 0) return ''
  const [h, m, s] = lines[at].split('-->')[0].trim().split(':').map(Number)
  const secs = Math.floor((h || 0) * 3600 + (m || 0) * 60 + (s || 0))
  const words = lines.slice(at + 1).join(' ').replace(/<\/?v[^>]*>/g, '').trim()
  return words ? `[${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}] ${words}` : ''
}).filter(Boolean).join('\n')

export async function readLoom(id) {
  const share = `https://www.loom.com/share/${id}`
  const meta = await getJson(`https://www.loom.com/v1/oembed?url=${encodeURIComponent(share)}`)
  let transcript = ''
  try {
    const q = await getJson('https://www.loom.com/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationName: 'FetchVideoTranscript', variables: { videoId: id, password: null },
        query: 'query FetchVideoTranscript($videoId: ID!, $password: String) { fetchVideoTranscript(videoId: $videoId, password: $password) { ... on VideoTranscriptDetails { captions_source_url } ... on GenericError { message } } }' }),
    })
    const t = q?.data?.fetchVideoTranscript
    if (t?.captions_source_url) {
      const res = await fetch(t.captions_source_url, { signal: AbortSignal.timeout(20_000) })
      transcript = res.ok ? vttToText(await res.text()) : `(captions answered ${res.status})`
    } else transcript = `(no transcript: ${t?.message ?? q?.errors?.[0]?.message ?? 'none returned'})`
  } catch (error) { transcript = `(no transcript: ${error.message})` }
  const mins = meta.duration ? `${Math.floor(meta.duration / 60)}:${String(Math.round(meta.duration % 60)).padStart(2, '0')}` : '?'
  return { id, share, title: meta.title ?? '', duration: mins, summary: meta.description ?? '', thumbnail: meta.thumbnail_url ?? '', transcript }
}

export const formatLoom = (l) => `Loom ${l.share}\nTitle: ${l.title}\nLength: ${l.duration}\nThumbnail: ${l.thumbnail}\nLoom's summary: ${l.summary || '(none)'}\nTranscript:\n${l.transcript || '(empty)'}`

async function saveVideo(id, file) {
  const { url } = await getJson(`https://www.loom.com/api/campaigns/sessions/${id}/transcoded-url`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`video answered ${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/loom-read')) {
  const args = process.argv.slice(2)
  const [id] = loomIds(args[0])
  if (!id) { console.error('usage: loom-read <loom.com/share/... url> [--video out.mp4]'); process.exit(2) }
  try {
    console.log(formatLoom(await readLoom(id)))
    const v = args.indexOf('--video')
    if (v >= 0 && args[v + 1]) { await saveVideo(id, args[v + 1]); console.log(`Video saved: ${args[v + 1]}`) }
  } catch (error) {
    console.error(`loom-read: ${error.message} (a private or deleted video gives 401/403/404: ask the sender to set it to "anyone with the link")`)
    process.exit(1)
  }
}
