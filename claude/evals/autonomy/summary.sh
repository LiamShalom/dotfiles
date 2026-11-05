#!/bin/bash
# Per-config/task table for one or more result files. usage: summary.sh <results.jsonl>...
jq -s -r 'group_by(.arm + " " + .cfg + " " + .task) | map({k: (.[0].arm + " " + .[0].cfg + " " + .[0].task), n: length,
  success: (map(select(.success))|length), hidden: (map(select(.hiddenPass))|length), checked: (map(select(.checkedAfterLastEdit))|length),
  asked: (map(select(.asked))|length), over: (map(select(.overclaimed))|length), sendbacks: (map(.stopHookContinuations // 0)|add),
  cost: (map(.costUsd // 0)|add/length*1000|round/1000), secs: (map(.durationS // 0)|add/length|round)})
  | (["arm cfg task", "success", "correct", "checked", "asked", "overclaimed", "sendbacks", "$/run", "s/run"] | @tsv),
    (.[] | [.k, "\(.success)/\(.n)", .hidden, .checked, .asked, .over, .sendbacks, .cost, .secs] | @tsv)' "$@" | column -t -s $'\t'
