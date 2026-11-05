#!/bin/bash
# Re-grade every saved run of one arm (after a grader or hidden-test fix) into <out>/results-<arm>.jsonl.
# usage: regrade.sh <out-root> <arm>
set -uo pipefail
out=$1 arm=$2
here=$(cd "$(dirname "$0")" && pwd)
: > "$out/results-$arm.jsonl"
for dir in "$out"/runs/"$arm"/*/*/r*; do
  cfg=$(basename "$(dirname "$(dirname "$dir")")")
  task=$(basename "$(dirname "$dir")")
  rep=${dir##*/r}
  node "$here/grade.mjs" "$task" "$dir/repo" "$dir/stream.jsonl" \
    | jq -c --arg arm "$arm" --arg cfg "$cfg" --arg rep "$rep" '{arm:$arm,cfg:$cfg,rep:$rep} + .' >> "$out/results-$arm.jsonl"
done
