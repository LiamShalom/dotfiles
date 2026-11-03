#!/usr/bin/env bash
# PreToolUse on page readers (WebFetch, Notion MCP fetch, agent Chrome navigation/new tab):
# when the target is a public *.notion.site page, point to notion-public-dump.py, which reads
# every block, expands collapsed toggles, follows sub-pages and ends with END OF DOCUMENT.
# Why: on 2026-11-03 a sliced browser read of a brief hub missed its "Sunsetted Briefs" section.
input=$(cat)
case "$input" in
  *notion.site*) ;;
  *) exit 0 ;;
esac
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"This is a public Notion page. To read its content, run `python3 -I ~/.claude/bin/notion-public-dump.py <url> --follow` instead: it reads every block, expands collapsed toggles, follows sub-pages and prints END OF DOCUMENT with counts. A browser innerText read (and any slice of it) stops early and silently drops the bottom of the page. Use the browser only to look at images or layout. Before you say something is not in the doc, grep the full dump for it."}}
JSON
