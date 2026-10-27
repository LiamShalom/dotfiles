#!/usr/bin/env bash
# PreToolUse on Bash: refuses a 1Password CLI command whose output would put secrets into the
# transcript. `op item get|edit|create` with --format json or --reveal prints passwords and
# authenticator keys in clear (2026-10-27: an `op item edit --format json` printed the Vercel
# password and TOTP key). The default text output hides them. Run op inside a script that keeps
# the output in memory.
cmd=$(jq -r '.tool_input.command // ""')
# Only where a command starts (line start, after ; & | or $( ), not inside quoted text.
printf '%s' "$cmd" | grep -Eq '(^|[;&|(]|\$\()[[:space:]]*op[[:space:]]+item[[:space:]]+(get|edit|create)([[:space:]]|$)' || exit 0
printf '%s' "$cmd" | grep -Eq -- '--format[ =]+json|--reveal' || exit 0
# Output kept out of the transcript.
printf '%s' "$cmd" | grep -Eq '>[[:space:]]*/dev/null' && exit 0

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"This 1Password command prints the item into the transcript, passwords and authenticator keys included. Run op inside a script that keeps the output in memory and prints only yes/no checks (see ~/.claude/jobs/*/tmp patterns), or add > /dev/null to an edit whose result you do not need. For a login, use agent-login."}}
JSON
