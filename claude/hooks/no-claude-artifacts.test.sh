#!/usr/bin/env bash
# Replays real operator prompts against no-claude-artifacts.sh. Run: bash no-claude-artifacts.test.sh
hook="$(dirname "$0")/no-claude-artifacts.sh"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail=0
check() { # expected(deny|allow) action prompt
  local want=$1 action=$2 prompt=$3 t="$tmp/t.jsonl"
  jq -nc --arg p "$prompt" '{type:"user",origin:{kind:"human"},message:{role:"user",content:$p}}' > "$t"
  jq -nc '{type:"user",message:{role:"user",content:[{type:"tool_result",content:"ok"}]}}' >> "$t"
  # Injected text after the prompt (a skill body that says "make an artifact") must not count.
  jq -nc '{type:"user",isMeta:true,message:{role:"user",content:[{type:"text",text:"Base directory for this skill: make it an artifact, shareable"}]}}' >> "$t"
  out=$(jq -nc --arg a "$action" --arg t "$t" '{tool_name:"Artifact",transcript_path:$t,tool_input:(if $a=="" then {} else {action:$a} end)}' | bash "$hook")
  got=allow; printf '%s' "$out" | grep -q '"deny"' && got=deny
  if [ "$got" = "$want" ]; then echo "ok   $want  [$action] $prompt"; else echo "FAIL want $want got $got  [$action] $prompt"; fail=1; fi
}
# 2026-11-19, the real prompts before each publish and the correction itself.
check deny  ""        "open the ss"
check deny  ""        "This looks too alarming. Can you copy the same UI that redlining uses"
check deny  "publish" "open it in session pane. You shouldnt be making actual claude artifacts"
check deny  ""        "show me some of the UI screens that came inluded with this"
# Requests that do want one.
check allow ""        "make this an artifact so Don can see it"
check allow ""        "write it up so I can share it with the team"
# Non-publish actions always pass.
check allow "read"    "open the ss"
check allow "list"    "open the ss"
exit $fail
