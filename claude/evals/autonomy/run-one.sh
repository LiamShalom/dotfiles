#!/bin/bash
# Run one eval case and grade it.
# usage: run-one.sh <out-root> <arm> <model> <effort> <task> <rep>
# Writes <out-root>/runs/<arm>/<model>-<effort>/<task>/r<rep>/{repo,stream.jsonl,metrics.json}.
set -uo pipefail
out=$1 arm=$2 model=$3 effort=$4 task=$5 rep=$6
here=$(cd "$(dirname "$0")" && pwd)
dir="$out/runs/$arm/$model-$effort/$task/r$rep"
rm -rf "$dir"
mkdir -p "$dir/repo/hidden"
cp -R "$here/fixture/." "$dir/repo/"
git -C "$dir/repo" init -q
git -C "$dir/repo" add -A
git -C "$dir/repo" -c user.name=eval -c user.email=eval@example.com commit -qm init

cd "$dir/repo"
CLAUDE_CONFIG_DIR="$out/arms/$arm" claude -p "$(cat "$here/tasks/$task.txt")" \
  --model "$model" --effort "$effort" \
  --output-format stream-json --verbose --include-hook-events \
  --dangerously-skip-permissions --max-budget-usd 3 \
  > "$dir/stream.jsonl" 2> "$dir/stderr.txt"
node "$here/grade.mjs" "$task" "$dir/repo" "$dir/stream.jsonl" > "$dir/metrics.json"
jq -c --arg arm "$arm" --arg cfg "$model-$effort" --arg rep "$rep" '{arm:$arm,cfg:$cfg,rep:$rep} + .' "$dir/metrics.json"
