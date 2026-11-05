#!/bin/bash
# Build an isolated Claude config dir for one eval arm.
# usage: setup-arm.sh <arm-dir> <claude-md-file> <baseline|treatment>
# The arm gets only the relay env from the live settings (no MCP, skills or other hooks), the given
# CLAUDE.md, and the Stop hooks of that arm. Hooks force CLAUDE_CODE_ENTRYPOINT=cli because they skip
# headless (`sdk-*`) runs, and every eval run is headless.
set -euo pipefail
arm_dir=$1
claude_md=$2
kind=$3
mkdir -p "$arm_dir"
chmod 700 "$arm_dir"
cp "$claude_md" "$arm_dir/CLAUDE.md"

stop_hooks='[
  {"type":"command","command":"CLAUDE_CODE_ENTRYPOINT=cli bash ~/.claude/hooks/ask-check.sh"},
  {"type":"command","command":"CLAUDE_CODE_ENTRYPOINT=cli bash ~/.claude/hooks/test-before-reply.sh"}
]'
subagent_hooks='[]'
if [ "$kind" = treatment ]; then
  judge="CLAUDE_CODE_ENTRYPOINT=cli FINISH_JUDGE_LOG=$arm_dir/judge.jsonl bash ~/.claude/hooks/finish-judge.sh"
  stop_hooks=$(jq -c --arg c "$judge" '. + [{"type":"command","command":$c,"timeout":180}]' <<<"$stop_hooks")
  subagent_hooks=$(jq -nc --arg c "$judge" '[{"type":"command","command":$c,"timeout":180}]')
  mkdir -p "$arm_dir/agents"
  ln -sf "$HOME/.claude/agents/skeptical-verifier.md" "$arm_dir/agents/skeptical-verifier.md"
fi

jq --argjson stop "$stop_hooks" --argjson sub "$subagent_hooks" '{
  env: (.env | with_entries(select(.key | test("^ANTHROPIC_|^API_TIMEOUT_MS$|^CLAUDE_CODE_SUBAGENT_MODEL$")))),
  skipDangerousModePermissionPrompt: true,
  hooks: ({Stop: [{matcher: "", hooks: $stop}]} + (if ($sub | length) > 0 then {SubagentStop: [{matcher: "", hooks: $sub}]} else {} end))
}' "$HOME/.claude/settings.json" > "$arm_dir/settings.json"
chmod 600 "$arm_dir/settings.json"
