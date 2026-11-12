#!/usr/bin/env bash
# Replays the real 2026-11-11 mistakes against no-tiktok-oembed-liveness.sh, plus cases it must allow.
hook="$(dirname "$0")/no-tiktok-oembed-liveness.sh"
fail=0
expect() { # expect <deny|allow> <label> <json>
  out=$(printf '%s' "$3" | bash "$hook" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)
  got=${out:-allow}
  if [ "$got" = "$1" ]; then echo "ok   $2"; else echo "FAIL $2 (got $got)"; fail=1; fi
}
expect deny  'curl to oEmbed (the 11-11 check)' \
  '{"tool_name":"Bash","tool_input":{"command":"curl -s -o /dev/null -w \"oembed %{http_code}\" \"https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40holistic_dre%2Fvideo%2F7609715305610366221\""}}'
expect deny  'heredoc script that fetches oEmbed (tiktok-crosscheck.mjs)' \
  '{"tool_name":"Bash","tool_input":{"command":"cat > /Users/liamshalom/.claude/jobs/0a76d22f/tmp/tiktok-crosscheck.mjs <<EOF\nconst o = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(r.post_page)}`)\nEOF"}}'
expect deny  'scratch script written with fetch to /embed/v2' \
  '{"tool_name":"Write","tool_input":{"file_path":"/Users/liamshalom/.claude/jobs/x/tmp/a.mjs","content":"await fetch(\"https://www.tiktok.com/embed/v2/123\")"}}'
expect allow 'memory note that names the endpoint' \
  '{"tool_name":"Bash","tool_input":{"command":"python3 - <<EOF\nnote = \"`https://www.tiktok.com/embed/v2/{id}` answers 200 for made-up ids\"\nEOF"}}'
expect allow 'repo edit that names oEmbed' \
  '{"tool_name":"Edit","tool_input":{"file_path":"/Users/liamshalom/sideshift-monorepo/lib/analytics.ts","new_string":"await fetch(`https://www.tiktok.com/oembed?url=${u}`)"}}'
expect allow 'unrelated command' '{"tool_name":"Bash","tool_input":{"command":"gh pr checks 8925"}}'
exit $fail
