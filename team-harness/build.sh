#!/usr/bin/env bash
#
# build.sh — make the team copy of Liam's Claude Code harness from ~/dotfiles.
# It leaves out what is personal (logins, inboxes, Slack-as-Liam, the learning
# ledger, the nightly Android job) and strips every token from settings.json.
#
# Usage:  tools/build.sh [out-dir]     (default ~/sideshift-claude-harness)
set -euo pipefail

SRC="${SRC:-$HOME/dotfiles}"
LIVE_SETTINGS="${LIVE_SETTINGS:-$HOME/.claude/settings.json}"
OUT="${1:-$HOME/sideshift-claude-harness}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$OUT"
rm -rf "$OUT/claude" "$OUT/codex" "$OUT/launchd" "$OUT/migrate"

rsync -a \
	--exclude '.DS_Store' --exclude '*.bak' --exclude '*.bak-*' \
	--exclude '.workspace/' \
	--exclude '/skills/synced/' \
	--exclude '/skills/agent-login/' \
	--exclude '/bin/slack-as-liam' \
	--exclude '/bin/agent-mail.mjs' \
	--exclude '/bin/agent-sms*.mjs' \
	--exclude '/bin/agent-login*.mjs' \
	--exclude '/bin/android-port-nightly.sh' \
	--exclude '/bin/learning-weekly.sh' \
	--exclude '/bin/*.test.mjs' \
	--exclude '/hooks/slack-send-gate.sh' \
	--exclude '/learning/' --exclude '/features/' --exclude '/evals/' --exclude '/slack/' \
	--exclude '/references/provider-policy-audits.md' \
	--exclude '/settings.json' \
	"$SRC/claude/" "$OUT/claude/"

rsync -a --exclude '.DS_Store' "$SRC/codex/" "$OUT/codex/"
# Liam's Codex model gateway is personal: drop its provider table and the keys that select it.
awk '
	/^\[model_providers\./ { skip = 1; next }
	/^\[/ { skip = 0 }
	skip { next }
	/^(openai_base_url|model_provider) *=/ { next }
	/managed:(start|end)/ { next }
	{ print }
' "$OUT/codex/config.toml" >"$OUT/codex/config.toml.tmp"
mv "$OUT/codex/config.toml.tmp" "$OUT/codex/config.toml"

# Test fixtures quoted real Slack messages: replace the people in them.
sed -i '' \
	-e 's/Jadon Davis/Alex Example/g' -e 's/jadon@sideshift\.app/alex@example.com/g' -e 's/U0AN5843W3C/U00000000A1/g' \
	-e "s/'Gul'/'Sam'/g" -e 's/From: Gul </From: Sam </g' -e 's/gul@infinitegrowthugc\.com/sam@example.com/g' \
	-e 's/U0CCBKWSRPB/U00000000B2/g' -e 's/Infinitegrowthugc/Exampleco/g' \
	"$OUT/claude/mods/session-namer/hooks/register.test.ts"

# Teammates have no agent-login skill (Liam's 1Password) and maybe no Session Board.
sed -i '' \
	-e 's#first use the$#first sign in yourself if the login is a SideShift test account#' \
	-e 's#^  `agent-login` skill if 1Password has a login for the site: it types the login into your tab$#  (credentials through `~/sideshift-monorepo/.codex/with-test-secrets`); a personal login always#' \
	-e 's#^  with no prompt (1Password vaults Agent Logins and Agent-Test). When it can.t, hand the step to me$#  comes to me. Hand the step to me#' \
	-e 's#try the `agent-login` skill first when saved credentials#sign in yourself first when the SideShift test credentials#' \
	"$OUT/claude/CLAUDE.md"
perl -pi -e 's#\| \(if env\.CLAUDE_CODE_ENTRYPOINT == "claude-desktop" then .* end\) as \$signin#| "`node ~/.claude/bin/agent-signin.mjs <url>` if Session Board is installed, otherwise sign in on the page with the credentials from `~/sideshift-monorepo/.codex/with-test-secrets` (Dev Testing Liam is the shared test brand" as \$signin#' "$OUT/claude/hooks/test-before-reply.sh"
sed -i '' \
	-e 's#for any other site use the agent-login skill#for any other site sign in with a test account you can reach#' \
	-e 's#asks Liam to sign in#asks the operator to sign in#' \
	"$OUT/claude/hooks/test-before-reply.sh"
sed -i '' -e 's#For other sites use the agent-login skill\.#For other sites, sign in with a test account or ask the operator.#' "$OUT/claude/bin/agent-signin.mjs"
sed -i '' -e 's#For a login, use agent-login\.#For a login, sign in with a test account or ask the operator.#' "$OUT/claude/hooks/op-secrets-gate.sh"
sed -i '' \
	-e 's#asks Liam to sign in#asks the operator to sign in#' -e 's#Hand a sign-in to Liam#Hand a sign-in to the operator#' -e 's#the one step Liam must do#the one step the operator must do#' \
	"$OUT/claude/hooks/test-before-reply.sh"

mkdir -p "$OUT/launchd"
for f in "$SRC"/launchd/*.plist; do
	case "$(basename "$f")" in
	com.sideshift.android-port.nightly.plist | com.sideshift.learning.weekly.plist) continue ;;
	esac
	cp "$f" "$OUT/launchd/"
done

mkdir -p "$OUT/migrate" "$OUT/claude/learning"
cp "$SRC/migrate/repos.txt" "$OUT/migrate/repos.txt"
cat >"$OUT/claude/learning/ledger.md" <<'EOF'
# Learning ledger

One row per lesson the `correct` skill moved into something that fails.

| Date | Correction | Enforced by | Proved by |
| ---- | ---------- | ----------- | --------- |
EOF

# Paths: Liam's machine -> any teammate's machine.
H='sideshift-claude-harness'
grep -rIl --null -e 'dotfiles' -e '/Users/liam' "$OUT" | while IFS= read -r -d '' f; do
	sed -i '' \
		-e "s#/Users/liamshalom/dotfiles/claude#~/$H/claude#g" \
		-e "s#\$HOME/dotfiles/claude#\$HOME/$H/claude#g" \
		-e "s#~/dotfiles/claude#~/$H/claude#g" \
		-e "s#\$HOME/dotfiles/migrate#\$HOME/$H/migrate#g" \
		-e "s#\$HOME/dotfiles/Brewfile#\$HOME/$H/Brewfile#g" \
		-e "s#/Users/liamshalom/#~/#g" \
		-e "s#/Users/liam-sideshift/#~/#g" \
		"$f"
done
# launchd templates: the monorepo can live anywhere.
sed -i '' -e 's#__HOME__/sideshift-monorepo#__MONOREPO__#g' "$OUT"/launchd/*.plist

# settings.json from the live file, with every credential and the personal
# model gateway removed. The team uses its own Claude login.
jq '
	del(.env.ANTHROPIC_AUTH_TOKEN, .env.ANTHROPIC_CUSTOM_HEADERS, .env.ANTHROPIC_BASE_URL,
	    .env.ANTHROPIC_API_KEY,
	    .env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY,
	    .env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT,
	    .env.ANTHROPIC_DEFAULT_SONNET_MODEL, .env.ANTHROPIC_DEFAULT_OPUS_MODEL,
	    .env.ANTHROPIC_DEFAULT_HAIKU_MODEL, .env.ANTHROPIC_DEFAULT_FABLE_MODEL,
	    .hasCompletedOnboarding, .oauthAccount, .userID, .apiKeyHelper,
	    .modelPicker, .disabledMcpjsonServers)
	| .env.BRAINSTORM_OPEN_CMD = "__HOME__/.claude/bin/open-in-pane.sh"
	| .hooks.PreToolUse |= map(select(any(.hooks[]; .command | test("slack-send-gate")) | not))
' "$LIVE_SETTINGS" >"$OUT/claude/settings.json"

# tools/ keeps the sources of install.sh and README.md, so tools/build.sh can run from a copy.
mkdir -p "$OUT/tools"
cp "$HERE/install.sh" "$OUT/install.sh"
cp "$HERE/README.md" "$OUT/README.md"
for f in build.sh install.sh README.md; do
	[ "$HERE/$f" -ef "$OUT/tools/$f" ] || cp "$HERE/$f" "$OUT/tools/$f"
done
chmod +x "$OUT/install.sh" "$OUT/tools/build.sh" "$OUT/tools/install.sh"

echo "built $OUT"
