#!/usr/bin/env bash
# PreToolUse on Bash: refuses a 1Password CLI command whose output would put secrets into the
# transcript (2026-10-27: an `op item edit --format json` printed the Vercel password and TOTP
# key). Printing ones: `op item get|edit|create` with --format json or --reveal, `op read`,
# `op inject` without -o/--out-file, `op document get` without -o/--out-file. The default text
# output of item get/edit hides secrets; --otp is a 30-second code. Run op inside a script that
# keeps the output in memory.
cmd=$(jq -r '.tool_input.command // ""')
# Where a command starts (line start, after ; & | ( or $( ), past env assignments and wrappers,
# but not inside quoted text such as a commit message.
start='(^|[;&|(]|\$\()[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|time|sudo|command|exec|nohup)[[:space:]]+)*op[[:space:]]+'
prints=0
if printf '%s' "$cmd" | grep -Eq "${start}item[[:space:]]+(get|edit|create)([[:space:]]|\$)"; then
  printf '%s' "$cmd" | grep -Eq -- '--format[ =]+json|--reveal' && prints=1
fi
printf '%s' "$cmd" | grep -Eq "${start}read([[:space:]]|\$)" && prints=1
if printf '%s' "$cmd" | grep -Eq "${start}(inject|document[[:space:]]+get)([[:space:]]|\$)"; then
  printf '%s' "$cmd" | grep -Eq -- '(^|[[:space:]])(-o|--out-file)([ =]|$)' || prints=1
fi
[ "$prints" = 1 ] || exit 0
# Only stdout sent to /dev/null keeps it out; 2>/dev/null hides errors, not the secret.
printf '%s' "$cmd" | grep -Eq '(^|[^0-9&])1?>[[:space:]]*/dev/null' && exit 0

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"This 1Password command prints secrets into the transcript (passwords, authenticator keys or a secret's value). Run op inside a script that keeps the output in memory and prints only yes/no checks, write it to a file with -o, or send stdout to /dev/null for an edit whose result you do not need. For a login, use agent-login."}}
JSON
