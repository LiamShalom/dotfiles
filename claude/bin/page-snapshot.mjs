#!/usr/bin/env node
// page-snapshot.mjs — save a page that is open in the agent Chrome as ONE self-contained HTML file:
// its live DOM (with current form values), all of its CSS (including rules a CSS-in-JS library
// inserted at run time), and its images and fonts as data URIs. Scripts are removed, so the result
// is a faithful static copy that an agent then makes clickable with its own inline JS, and that
// publishes as a claude.ai Artifact (no external hosts needed).
//
// Assets come from Chrome's own resource cache first (Page.getResourceContent), so a signed-in or
// Vercel-protected page snapshots without cookies or CORS; Node fetch is the fallback.
//
// Usage:
//   page-snapshot.mjs --tab <targetId> --out <file.html>
//   page-snapshot.mjs [--as brand | creator] <sideshift-url> --out <file.html>   (signs in via agent-signin.mjs)
// Options: --title <name> (the artifact's name; defaults to the page title or its h1), --wait <ms>
// (settle time before capture, default 1500), --max-asset-kb <n> (larger assets stay as absolute
// URLs, default 4000).
//
// The output is in Artifact form (no <html>/<head>/<body> of its own; the publish step adds them),
// so publish it as is with the Artifact tool. Opened directly as a file it renders in quirks mode.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const at = args.indexOf(name)
  if (at === -1) return fallback
  const [, value] = args.splice(at, 2)
  return value
}
let tab = opt('--tab')
const openedHere = !tab
const out = opt('--out')
const who = opt('--as', 'brand')
const title = opt('--title')
const waitMs = Number(opt('--wait', '1500'))
const maxAssetBytes = Number(opt('--max-asset-kb', '4000')) * 1024
const [url] = args
if (!out || (!tab && !url)) {
  console.error('usage: page-snapshot.mjs (--tab <targetId> | [--as brand|creator] <url>) --out <file.html> [--wait ms] [--max-asset-kb n]')
  process.exit(1)
}

const bin = join(homedir(), '.claude', 'bin')
const devtools = execFileSync(join(bin, 'agent-chrome.sh'), { encoding: 'utf8' }).trim()

if (!tab) {
  const said = execFileSync(join(bin, 'agent-signin.mjs'), ['--as', who, url], { encoding: 'utf8' })
  tab = said.match(/in tab (\S+) of this chat/)?.[1]
  if (!tab) {
    console.error(`agent-signin.mjs did not report a tab:\n${said}`)
    process.exit(1)
  }
}

const target = (await (await fetch(`${devtools}/json/list`)).json()).find((t) => t.id === tab)
if (!target?.webSocketDebuggerUrl) {
  console.error(`No page target ${tab} in the agent Chrome (chrome-devtools list_pages shows your tabs).`)
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((ok, fail) => {
  ws.onopen = ok
  ws.onerror = () => fail(new Error(`could not connect to tab ${tab}`))
})
let nextId = 0
const pending = new Map()
ws.onmessage = (event) => {
  const message = JSON.parse(String(event.data))
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result)
}
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

await call('Page.enable')
await new Promise((r) => setTimeout(r, waitMs))

// Runs in the page. Returns the cleaned HTML, the CSS of every sheet it could read, the sheets it
// could not (cross-origin), and every absolute asset URL the copy still points at.
const CAPTURE = `(() => {
  const abs = (u, base) => { try { return new URL(u, base || location.href).href } catch { return u } }
  const urls = new Set()
  const fixCss = (css, base) => css.replace(/url\\((['"]?)([^'")]+)\\1\\)/g, (m, q, u) => {
    if (/^(data|blob|about):|^#/.test(u)) return m
    const a = abs(u, base); urls.add(a); return 'url("' + a + '")'
  })
  const sheets = []
  const blocked = []
  const readSheet = (sheet) => {
    const media = sheet.media?.mediaText
    const scoped = (css) => (media && media !== 'all' ? '@media ' + media + ' {\\n' + css + '\\n}' : css)
    try {
      sheets.push(scoped(fixCss([...sheet.cssRules].map((r) => r.cssText).join('\\n'), sheet.href || location.href)))
    } catch { if (sheet.href) { blocked.push(sheet.href); sheets.push(scoped('/*@@SHEET ' + sheet.href + '@@*/')) } }
  }
  for (const sheet of document.styleSheets) if (!sheet.disabled) readSheet(sheet)
  for (const sheet of document.adoptedStyleSheets || []) readSheet(sheet)

  // Write live state into attributes so the clone keeps it.
  for (const el of document.querySelectorAll('input')) {
    if (el.type === 'checkbox' || el.type === 'radio') el.checked ? el.setAttribute('checked', '') : el.removeAttribute('checked')
    else if (el.type !== 'password' && el.type !== 'file') el.setAttribute('value', el.value)
  }
  for (const el of document.querySelectorAll('textarea')) el.textContent = el.value
  for (const el of document.querySelectorAll('option')) el.selected ? el.setAttribute('selected', '') : el.removeAttribute('selected')
  const canvases = [...document.querySelectorAll('canvas')].map((c) => { try { return c.toDataURL() } catch { return null } })
  const images = [...document.querySelectorAll('img')].map((img) => img.currentSrc || img.src)

  const root = document.documentElement.cloneNode(true)
  // Index the clone's images before canvases become <img>, so both lists line up with the page's.
  const cloneImages = [...root.querySelectorAll('img')]
  root.querySelectorAll('canvas').forEach((c, i) => {
    if (!canvases[i]) return
    const img = document.createElement('img'); img.src = canvases[i]
    img.setAttribute('style', c.getAttribute('style') || ''); img.className = c.className
    img.width = c.width; img.height = c.height; c.replaceWith(img)
  })
  cloneImages.forEach((img, i) => {
    const src = images[i]
    if (src && !src.startsWith('data:')) { const a = abs(src); urls.add(a); img.setAttribute('src', a) }
    img.removeAttribute('srcset'); img.removeAttribute('sizes'); img.removeAttribute('loading')
  })
  root.querySelectorAll('picture source').forEach((s) => s.remove())
  const absAttr = (selector, name) => root.querySelectorAll(selector).forEach((el) => {
    const v = el.getAttribute(name)
    if (v && !/^(data|blob):|^#/.test(v)) { const a = abs(v); urls.add(a); el.setAttribute(name, a) }
  })
  absAttr('video[poster]', 'poster')
  absAttr('video[src], audio[src], video source[src], audio source[src], input[type="image"][src]', 'src')
  absAttr('svg image[href]', 'href')
  absAttr('svg image[xlink\\\\:href]', 'xlink:href')
  // Artifacts cannot embed other sites; keep the frame's box, drop its content.
  root.querySelectorAll('iframe').forEach((f) => { f.removeAttribute('src'); f.removeAttribute('srcdoc') })
  root.querySelectorAll('[style]').forEach((el) => el.setAttribute('style', fixCss(el.getAttribute('style'))))
  root.querySelectorAll('script, noscript, style, link[rel~="stylesheet"], link[rel="preload"], link[rel="modulepreload"], link[rel="prefetch"], link[rel="preconnect"], link[rel="dns-prefetch"], link[rel="manifest"], base, meta[http-equiv]').forEach((el) => el.remove())
  root.querySelectorAll('[nonce]').forEach((el) => el.removeAttribute('nonce'))
  root.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', abs(a.getAttribute('href'))))
  root.querySelectorAll('svg use').forEach((u) => {
    for (const name of ['href', 'xlink:href']) {
      const v = u.getAttribute(name); if (v && !v.startsWith('#')) { const a = abs(v); urls.add(a); u.setAttribute(name, a) }
    }
  })
  const attrs = (el) => Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]))
  const body = root.querySelector('body')
  return { body: body.innerHTML, htmlAttrs: attrs(root), bodyAttrs: attrs(body), sheets, blocked, urls: [...urls], title: document.title || document.querySelector('h1')?.textContent?.trim() || '', href: location.href }
})()`

const evaluated = await call('Runtime.evaluate', { expression: CAPTURE, returnByValue: true })
if (evaluated.exceptionDetails) throw new Error(`capture failed in the page: ${evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text}`)
const page = evaluated.result.value

// Every resource the page loaded, by URL, with the frame that holds it.
const { frameTree } = await call('Page.getResourceTree')
const cached = new Map()
const walk = (node) => {
  for (const r of node.resources ?? []) cached.set(r.url, { frameId: node.frame.id, mimeType: r.mimeType })
  for (const child of node.childFrames ?? []) walk(child)
}
walk(frameTree)

const guessMime = (u) => {
  const ext = new URL(u).pathname.split('.').pop().toLowerCase()
  return { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', css: 'text/css' }[ext]
}

async function load(u) {
  const hit = cached.get(u)
  if (hit) {
    try {
      const { content, base64Encoded } = await call('Page.getResourceContent', { frameId: hit.frameId, url: u })
      const bytes = base64Encoded ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8')
      return { bytes, mime: hit.mimeType || guessMime(u) }
    } catch {}
  }
  // Fallback outside the browser: a page can name any URL (a creator's avatar link), so only fetch
  // the page's own origin or public hosts, never this Mac or a private network, and only keep assets.
  try {
    // Follow redirects by hand so every hop passes the same check.
    let next = u
    let res
    for (let hop = 0; hop < 5; hop++) {
      if (!(await fetchable(next))) return null
      res = await fetch(next, { signal: AbortSignal.timeout(15000), redirect: 'manual' })
      const to = res.status >= 300 && res.status < 400 && res.headers.get('location')
      if (!to) break
      next = new URL(to, next).href
    }
    const mime = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
    if (res.ok && ASSET_MIME.test(mime)) return { bytes: Buffer.from(await res.arrayBuffer()), mime }
  } catch {}
  return null
}

const ASSET_MIME = /^(image\/|font\/|text\/css$|application\/(font-woff2?|x-font-[\w.-]+|vnd\.ms-fontobject)$)/
const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^22[4-9]\.|^2[3-5]\d\./]
const isPrivate = ({ address, family }) => {
  const a = address.toLowerCase()
  if (family === 4) return PRIVATE_V4.some((r) => r.test(a))
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return PRIVATE_V4.some((r) => r.test(mapped[1]))
  return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a)
}
async function fetchable(u) {
  const parsed = new URL(u)
  if (parsed.origin === new URL(page.href).origin) return true
  const { lookup } = await import('node:dns/promises')
  const addresses = await lookup(parsed.hostname, { all: true })
  return addresses.length > 0 && !addresses.some(isPrivate)
}

let css = page.sheets.join('\n')
const missed = []
for (const href of page.blocked) {
  const got = await load(href)
  const text = got ? got.bytes.toString('utf8') : ''
  if (!got) missed.push(href)
  const fixed = text.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => {
    if (/^(data|blob|about):|^#/.test(u)) return m
    const a = new URL(u, href).href
    page.urls.push(a)
    return `url("${a}")`
  })
  css = css.replace(`/*@@SHEET ${href}@@*/`, () => fixed)
}

// Artifact form: the publish step wraps the file in its own <html><head><body>, so the copy brings
// only a title, its CSS, a script that puts the app's <html>/<body> attributes (the design-system
// scope classes live there) on the wrapper's elements, and the body's content.
const escapeText = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
const pageTitle = title || page.title || 'Page copy'
let html = `<title>${escapeText(pageTitle)}</title>
<style>${css}</style>
<script>(() => {
  const set = (el, attrs) => { for (const [k, v] of Object.entries(attrs)) if (k !== 'style' || !el.getAttribute('style')) el.setAttribute(k, v) }
  set(document.documentElement, ${JSON.stringify(page.htmlAttrs).replaceAll('<', '\\u003c')})
  set(document.body, ${JSON.stringify(page.bodyAttrs).replaceAll('<', '\\u003c')})
})()</script>
${page.body}`
const escapeAttr = (s) => s.replaceAll('&', '&amp;')
// An asset the Artifact cannot load becomes a transparent pixel, so nothing points at a blocked host.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
let inlined = 0
const tooBig = []
// Longest first, so a URL that is a prefix of another never rewrites part of it.
for (const u of [...new Set(page.urls)].sort((a, b) => b.length - a.length)) {
  if (!/^https?:/.test(u)) continue
  const got = await load(u)
  let data = BLANK
  if (!got) missed.push(u)
  else if (got.bytes.length > maxAssetBytes) tooBig.push(`${u} (${Math.round(got.bytes.length / 1024)} KB)`)
  else {
    data = `data:${got.mime || 'application/octet-stream'};base64,${got.bytes.toString('base64')}`
    inlined++
  }
  // Raw in CSS and in attributes without '&'; '&amp;'-escaped in attributes (and inside &quot; in style attributes).
  html = html.replaceAll(u, () => data)
  if (u.includes('&')) html = html.replaceAll(escapeAttr(u), () => data)
}
// A tab this run opened is closed; a tab passed with --tab stays for the caller.
if (openedHere) await call('Page.close').catch(() => {})
ws.close()

writeFileSync(resolve(out), html)
const mb = (Buffer.byteLength(html) / 1048576).toFixed(2)
console.log(`Saved ${page.href} ("${page.title}") to ${resolve(out)}: ${mb} MB, ${inlined} assets inlined.`)
if (Number(mb) > 16) console.log('WARNING: over the 16 MB Artifact limit. Lower --max-asset-kb or remove large images.')
if (tooBig.length) console.log(`Replaced with a blank pixel (over --max-asset-kb):\n  ${tooBig.join('\n  ')}`)
if (missed.length) console.log(`Could not load, replaced with a blank pixel (the live page may not have loaded them yet; scroll them into view and capture again):\n  ${[...new Set(missed)].join('\n  ')}`)
console.log('Scripts were removed. Add the interactions with inline JS and fixture state before you publish.')
