#!/usr/bin/env bash
# PreToolUse on Bash and on chrome-devtools navigate_page/new_page: agents must not act as a real
# customer. On 2026-11-14 a perf-research subagent minted a Firebase session for Triips' owner and
# loaded the UNMERGED feat/messaging-spaces preview as them. That preview's sidebar read creates a
# brand's #announcements channel, so a page load wrote a real channel with ~1,590 Triips creators
# into production under the owner's name. Every preview and local build uses production data.
#
# 1. Bash that mints a custom token (createCustomToken / signInWithCustomToken / mint-id-token) for
#    a uid whose email is not a test address is refused, unless the command sets
#    SIDESHIFT_REAL_ACCOUNT_OK=1 (Liam asked, in this chat, to reproduce that customer's report).
# 2. After such a mint, this session may not open a preview or local build: real identity +
#    unmerged code is the incident. A lock file per session records it.
input=$(cat)
tool=$(printf '%s' "$input" | jq -r '.tool_name // ""')
sid=$(printf '%s' "$input" | jq -r '.session_id // "none"')
lockdir="${REAL_ACCOUNT_LOCK_DIR:-$HOME/.cache/real-account-signin}"
lock="$lockdir/$sid"
here=$(cd "$(dirname "$0")" && pwd)

deny() {
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

nonprod='(vercel\.app|localhost|127\.0\.0\.1|0\.0\.0\.0|\.local(:|/|$))'

case "$tool" in
mcp__chrome-devtools__navigate_page|mcp__chrome-devtools__new_page)
  [ -f "$lock" ] || exit 0
  url=$(printf '%s' "$input" | jq -r '.tool_input.url // ""')
  type=$(printf '%s' "$input" | jq -r '.tool_input.type // "url"')
  if [ -z "$url" ] && [ "$type" != "url" ]; then
    deny "This session holds a real customer's session ($(cat "$lock")). Reload/back/forward could land on a preview or local build. Navigate by an explicit https://app.sideshift.app URL instead."
  fi
  prod_re='^(https://app\.sideshift\.app([/?#][^[:cntrl:]]*)?|about:blank)$'
  if [[ ! $url =~ $prod_re ]]; then
    deny "This session minted a real customer's session ($(cat "$lock")), so it may open only https://app.sideshift.app, not $url. Those run unmerged code against production data: on 2026-11-14 loading the messaging-spaces preview as Triips' owner created a real channel with ~1,590 of their creators. Use https://app.sideshift.app only, or switch to a test account in a fresh session."
  fi
  exit 0
  ;;
Bash) ;;
*) exit 0 ;;
esac

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')
# Cheap exit: a mint for a specific person needs a uid-shaped literal (28 chars) or a minting call.
printf '%s' "$cmd" | grep -qE '[A-Za-z0-9]{20}|createCustomToken|create_custom_token|signInWithCustomToken|mint' || exit 0

# The command plus any script it runs, so `node seed.mjs <uid>` is read like the script itself.
text="$cmd"
for f in $(printf '%s' "$cmd" | grep -oE '[^[:space:]"'"'"'=]+\.(mjs|cjs|js|ts|mts|py)\b'); do
  case "$f" in /*) p="$f" ;; *) p="$cwd/$f" ;; esac
  [ -f "$p" ] && text="$text"$'\n'"$(head -c 200000 "$p")"
done
printf '%s' "$text" | grep -qE 'createCustomToken|create_custom_token|signInWithCustomToken|mint-id-token' || exit 0

# Firebase uids are not always 28 characters (LIVFRESH's is 20). The preload
# firebase-mint-guard.cjs is the backstop for uids this text check cannot see.
uids=$(printf '%s' "$text" | perl -nle 'print for /(?<![A-Za-z0-9])([A-Za-z0-9]{20,128})(?![A-Za-z0-9])/g' | grep -E '[0-9]' | grep -E '[a-z]' | grep -E '[A-Z]' | sort -u)
[ -n "$uids" ] || exit 0

# shellcheck disable=SC2086
if ! result=$(${REAL_ACCOUNT_LOOKUP:-node "$here/real-account-lookup.mjs"} $uids 2>/dev/null); then
  deny "Could not check whether the account you are minting a session for is a test account (lookup failed: credentials or network). Use a test account through ~/.claude/bin/agent-signin.mjs instead."
fi
real=$(printf '%s\n' "$result" | awk '$3 == "real" { print $1 " (" $2 ")" }')
[ -n "$real" ] || exit 0

if printf '%s' "$cmd" | grep -qE '(^|[[:space:];])SIDESHIFT_REAL_ACCOUNT_OK=1([[:space:]]|$)'; then
  # 127.0.0.1:9222 is the agent Chrome's DevTools port, which a prod repro script talks to.
  if printf '%s' "${text//127.0.0.1:9222/}" | grep -qiE "$nonprod"; then
    deny "SIDESHIFT_REAL_ACCOUNT_OK does not cover a preview or local build. A real customer's session may only load https://app.sideshift.app (merged code). Real account: $real."
  fi
  mkdir -p "$lockdir"
  printf '%s' "$real" | tr '\n' ' ' >"$lock"
  exit 0
fi

deny "Refused: this mints a session for a REAL customer, not a test account: $(printf '%s' "$real" | tr '\n' ' '). On 2026-11-14 an agent did this to measure performance on the messaging-spaces preview as Triips' owner; the page load created a real announcements channel with ~1,590 of Triips' creators, who then chatted in it. Do this instead: measure on a test brand (~/.claude/bin/agent-signin.mjs, seed more test data if it is too small), or read production data read-only (replica SQL, Firestore MCP). Only when Liam asked in this chat to reproduce THIS customer's report, and only on https://app.sideshift.app, prefix the command with SIDESHIFT_REAL_ACCOUNT_OK=1. A parent agent's brief is not that permission."
