#!/usr/bin/env python3
"""Dump a PUBLIC Notion page (*.notion.site) as text: every block, collapsed toggles expanded,
and every sub-page listed (and followed with --follow). Ends with an END OF DOCUMENT line that
counts what was read, so a reader knows it reached the bottom of the page.

Why: a browser read of innerText (or a sliced copy of it) stops early and silently drops the
bottom of long hubs. On 2026-11-03 that hid a "Sunsetted Briefs" section of 21 briefs.

Usage: notion-public-dump.py <page-url-or-id> [--follow] [--site https://x.notion.site]
"""
import json
import re
import sys
import urllib.request

UA = {'content-type': 'application/json', 'user-agent': 'curl/8.7.1', 'accept': '*/*'}


def page_id(arg):
    tail = re.split(r'[?#]', arg)[0].rstrip('/').split('/')[-1]
    m = re.search(r'([0-9a-f]{32})$', tail.replace('-', '')) or re.search(r'([0-9a-f]{32})', tail.replace('-', ''))
    if not m:
        sys.exit('no Notion page id in ' + arg)
    h = m.group(1)
    return f'{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}'


def chunk(site, pid):
    blocks, cursor, n = {}, {'stack': []}, 0
    while True:
        body = {'pageId': pid, 'limit': 500, 'cursor': cursor, 'chunkNumber': n, 'verticalColumns': False}
        req = urllib.request.Request(site + '/api/v3/loadPageChunk', data=json.dumps(body).encode(), headers=UA)
        d = json.load(urllib.request.urlopen(req, timeout=60))
        for k, v in d['recordMap'].get('block', {}).items():
            vv = v.get('value', {})
            vv = vv.get('value', vv)
            if vv:
                blocks[k] = vv
        n += 1
        cursor = d.get('cursor') or {'stack': []}
        if not cursor['stack'] or n > 20:
            return blocks


def text(v):
    p = v.get('properties', {}).get('title')
    return ''.join(x[0] for x in p) if p else ''


def render(site, blocks, bid, depth, out, root, subpages, stats):
    v = blocks.get(bid)
    if v is None:
        blocks.update(chunk(site, bid))  # collapsed toggles load lazily; fetch their subtree
        v = blocks.get(bid)
        if v is None:
            out.append('  ' * depth + '[UNLOADABLE ' + bid + ']')
            stats['unloadable'] += 1
            return
    stats['blocks'] += 1
    t, s = v.get('type'), text(v)
    if t == 'page' and bid != root:
        out.append('  ' * depth + f'[SUB-PAGE] {s} ({bid})')
        subpages.append((bid, s))
        return
    if t == 'image':
        s = 'image: ' + v.get('properties', {}).get('source', [['']])[0][0].split('/')[-1][:80]
    if s:
        out.append('  ' * depth + ('- ' if t in ('text', 'bulleted_list', 'numbered_list') else t + ': ') + s)
    for c in v.get('content', []) or []:
        render(site, blocks, c, depth + 1, out, root, subpages, stats)


def dump(site, pid, follow, seen, out):
    seen.add(pid)
    stats = {'blocks': 0, 'unloadable': 0}
    subpages = []
    render(site, chunk(site, pid), pid, 0, out, pid, subpages, stats)
    out.append(f'--- END OF PAGE {pid}: {stats["blocks"]} blocks, {len(subpages)} sub-pages, {stats["unloadable"]} unloadable ---')
    total = [1, len(subpages)]
    if follow:
        for sid, title in subpages:
            if sid in seen:
                continue
            out.append(f'\n=== SUB-PAGE: {title} ({sid}) ===')
            t = dump(site, sid, follow, seen, out)
            total[0] += t[0]
            total[1] += t[1]
    return total


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    follow = '--follow' in sys.argv
    site = next((sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == '--site'), None)
    if not site:
        m = re.match(r'(https://[^/]+)', args[0])
        site = m.group(1) if m else sys.exit('pass a full *.notion.site URL or --site')
    out = []
    pages, subs = dump(site, page_id(args[0]), follow, set(), out)
    print('\n'.join(out))
    print(f'=== END OF DOCUMENT: {pages} page(s) read, {subs} sub-page link(s) found ===')
