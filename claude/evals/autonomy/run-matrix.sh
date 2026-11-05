#!/bin/bash
# Run every task x config x rep for one arm, 3 at a time, appending graded lines to <out>/results-<arm>.jsonl.
# usage: run-matrix.sh <out-root> <arm> <reps> [configs...]   configs default: "haiku:low" "sonnet:low"
set -uo pipefail
out=$1 arm=$2 reps=$3
shift 3
configs=("$@")
[ ${#configs[@]} -eq 0 ] && configs=(haiku:low sonnet:low)
here=$(cd "$(dirname "$0")" && pwd)
jobs=()
for cfg in "${configs[@]}"; do
  for task in $(ls "$here/tasks" | sed 's/\.txt$//'); do
    for rep in $(seq 1 "$reps"); do
      jobs+=("${cfg%%:*} ${cfg##*:} $task $rep")
    done
  done
done
printf '%s\n' "${jobs[@]}" | xargs -P 3 -L 1 bash -c 'bash "$0/run-one.sh" "$1" "$2" "$3" "$4" "$5" "$6"' "$here" "$out" "$arm" >> "$out/results-$arm.jsonl"
