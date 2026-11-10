#!/usr/bin/env bash
# Teammate install scenarios in a throwaway HOME.
# Usage: SRC_PKG=~/sideshift-claude-harness bash test-install.sh
set -uo pipefail
T="${TMPDIR:-/tmp}/harness-test-home.$$"
rm -rf "$T"; mkdir -p "$T/.claude/hooks" "$T/Downloads"
export HOME="$T"
echo "teammate ORIGINAL claude md" >"$T/.claude/CLAUDE.md"
echo "echo mine" >"$T/.claude/hooks/my-hook.sh"
mkdir -p "$T/.claude/skills/quick-fix"; echo "my own quick-fix" >"$T/.claude/skills/quick-fix/SKILL.md"
cat >"$T/.claude/settings.json" <<'EOF'
{"model":"sonnet","env":{"API_TIMEOUT_MS":"1234","ANTHROPIC_API_KEY":"fake"},
 "permissions":{"defaultMode":"default","allow":["Bash(ls)"]},
 "hooks":{"Stop":[{"matcher":"","hooks":[{"type":"command","command":"bash ~/.claude/hooks/my-hook.sh"}]}]}}
EOF
claude mcp add-json --scope user sideshift-firestore '{"type":"http","url":"http://127.0.0.1:9/mine"}' >/dev/null

cp -R "$SRC_PKG" "$T/Downloads/sideshift-claude-harness"
rm -rf "$T/Downloads/sideshift-claude-harness/.git"
bash "$T/Downloads/sideshift-claude-harness/install.sh" --with-mcp >/dev/null 2>&1
mv "$T/Downloads/sideshift-claude-harness" "$T/sideshift-claude-harness"
bash "$T/sideshift-claude-harness/install.sh" --with-mcp >/dev/null 2>&1
out=$(bash "$T/sideshift-claude-harness/install.sh" 2>&1)

check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fi; }
check "original CLAUDE.md kept in a real backup" 'grep -rlq "teammate ORIGINAL" "$T/.claude/" --include="CLAUDE.md*"'
check "own hook script still in ~/.claude/hooks" '[ -f "$T/.claude/hooks/my-hook.sh" ] && [ ! -L "$T/.claude/hooks" ]'
check "own Stop hook still in settings" 'jq -e "[.hooks.Stop[].hooks[].command] | index(\"bash ~/.claude/hooks/my-hook.sh\")" "$T/.claude/settings.json" >/dev/null'
check "harness Stop hook added" 'jq -e "[.hooks.Stop[].hooks[].command] | any(test(\"finish-judge\"))" "$T/.claude/settings.json" >/dev/null'
check "Stop hooks not duplicated after 3 runs" '[ "$(jq "[.hooks.Stop[].hooks[].command] | length" "$T/.claude/settings.json")" = "$(jq "[.hooks.Stop[].hooks[].command] | unique | length" "$T/.claude/settings.json")" ]'
check "own env value wins (API_TIMEOUT_MS=1234)" '[ "$(jq -r .env.API_TIMEOUT_MS "$T/.claude/settings.json")" = 1234 ]'
check "own model kept (sonnet)" '[ "$(jq -r .model "$T/.claude/settings.json")" = sonnet ]'
check "allow list kept" 'jq -e ".permissions.allow | index(\"Bash(ls)\")" "$T/.claude/settings.json" >/dev/null'
check "pre-harness backup is the original" '[ "$(jq -r .permissions.defaultMode "$T/.claude/settings.json.pre-harness")" = default ]'
check "own sideshift-firestore server kept" 'jq -e ".mcpServers[\"sideshift-firestore\"].url == \"http://127.0.0.1:9/mine\"" "$T/.claude.json" >/dev/null'
check "cloudsql server added by run was removed" '! jq -e ".mcpServers[\"cloud-sql-postgres-read-replica\"]" "$T/.claude.json" >/dev/null'
check ".claude.json backed up" '[ -f "$T/.claude.json.pre-harness" ]'
check "no symlink points into Downloads" '[ -z "$(find "$T/.claude" "$T/.codex" "$T/.agents" -type l -lname "*Downloads*")" ]'
check "no broken symlinks" '[ -z "$(find -L "$T/.claude" "$T/.codex" "$T/.agents" -type l)" ]'
check "third run changed nothing" '! printf "%s\n" "$out" | grep -qE "^(linked|backup|relinked|merged|unlinked)"'
check "own same-name skill backed up outside skills/" 'grep -q "my own quick-fix" "$T/.claude/harness-backup/.claude/skills/quick-fix.bak/SKILL.md" && [ -z "$(ls -d "$T"/.claude/skills/*.bak* 2>/dev/null)" ]'
check "no launchd touched" '[ ! -d "$T/Library/LaunchAgents" ]'
rm -rf "$T"
