#!/usr/bin/env bash
# PreToolUse on Bash: refuses a 1Password CLI command whose output would put secrets into the
# transcript (2026-10-27: an `op item edit --format json` printed the Vercel password and TOTP
# key). Printing ones: `op item get|edit|create` with --format json or --reveal, `op read`,
# `op inject` and `op document get` without -o/--out-file to a real file. The default text output
# of item get/edit hides secrets; --otp is a 30-second code. Run op inside a script that keeps the
# output in memory.
#
# It catches accidents, not intent: a script that prints op's output gets past any command-line
# check. Each part of a chained command is judged on its own, so a redirect elsewhere in the
# chain does not count.
cmd=$(jq -r '.tool_input.command // ""')
printf '%s' "$cmd" | grep -q 'op' || exit 0

# A part starts with optional ( { ! then/do/else/xargs, variable settings and wrappers, then op
# (or a path ending in /op) and any global flags before the subcommand.
lead='^[[:space:]]*([({!][[:space:]]*)*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|time|sudo|command|exec|nohup|then|do|else|xargs)[[:space:]]+)*([^[:space:]]*/)?op([[:space:]]+--?[A-Za-z][A-Za-z-]*(=[^[:space:]]+|[[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+'
to_file='(^|[[:space:]])(-o|--out-file)([[:space:]]+|=)[^-[:space:]]'
to_dev='(^|[[:space:]])(-o|--out-file)([[:space:]]+|=)/dev/'

deny=0
while IFS= read -r part; do
  # Quotes would hide a path such as "/dev/stdout" from the checks below.
  part=$(printf '%s' "$part" | tr -d "\"'")
  prints=0
  if printf '%s' "$part" | grep -Eq "${lead}item[[:space:]]+(get|edit|create)([[:space:]]|\$)"; then
    printf '%s' "$part" | grep -Eq -- '--format[ =]+json|--reveal' && prints=1
  fi
  printf '%s' "$part" | grep -Eq "${lead}read([[:space:]]|\$)" && prints=1
  if printf '%s' "$part" | grep -Eq "${lead}(inject|document[[:space:]]+get)([[:space:]]|\$)"; then
    if ! printf '%s' "$part" | grep -Eq -- "$to_file" || printf '%s' "$part" | grep -Eq -- "$to_dev"; then prints=1; fi
  fi
  [ "$prints" = 1 ] || continue
  # Only this part's stdout sent to /dev/null keeps it out; 2>/dev/null hides errors, not secrets.
  printf '%s' "$part" | grep -Eq '(^|[^0-9&])1?>[[:space:]]*/dev/null' && continue
  deny=1
# Split at `$(` with bash itself and at ; & | ` with tr: the same on BSD and GNU systems. A bare
# ( stays, since item names such as "Google (liam)" contain one.
done < <(printf '%s\n' "${cmd//\$(/$'\n'}" | tr ';&|`' '\n\n\n\n')
[ "$deny" = 1 ] || exit 0

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"This 1Password command prints secrets into the transcript (passwords, authenticator keys or a secret's value). Run op inside a script that keeps the output in memory and prints only yes/no checks, write it to a file with -o, or send that command's stdout to /dev/null for an edit whose result you do not need. For a login, use agent-login."}}
JSON
