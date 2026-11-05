# Autonomy eval

Measures whether agents finish the job on their own: do the whole request, run a real check
after the last edit, don't ask what they can settle themselves, and don't claim what they
didn't prove. It tests the global CLAUDE.md "#2 Rule" text and the finish judge
(`claude/hooks/finish-judge.sh`).

## Pieces

- `fixture/` — a small Node shop repo with planted bugs. `tasks/*.txt` are the prompts, in
  the operator's style. `hidden/*.test.js` decide whether the work is right; the agent never
  sees them.
- `grade.mjs` — grades one run from its repo and its `stream-json` transcript: hidden tests,
  check-after-last-edit, needless asks, overclaims, judge send-backs.
- `setup-arm.sh` — builds an isolated `CLAUDE_CONFIG_DIR` per arm (relay env only, the arm's
  CLAUDE.md and Stop hooks). `baseline` = the old CLAUDE.md + ask-check + test-before-reply;
  `treatment` adds the new CLAUDE.md, the finish judge on Stop and SubagentStop, and the
  `skeptical-verifier` agent.
- `run-one.sh`, `run-matrix.sh`, `regrade.sh`, `summary.sh` — run, re-grade and tabulate.
- `judge-fixtures.test.mjs` — the judge on synthetic turns with a known right answer, both
  "send back" and "let stop" cases (including a needed ask before a destructive real-data step).
- `replay.mjs` — the judge on real past turn-ends from your transcripts: turns your next
  message nudged ("go ahead", "test it", "continue") vs ordinary turns.

## Run

```bash
out=$CLAUDE_JOB_DIR/tmp/eval   # or any scratch dir
bash setup-arm.sh $out/arms/baseline <old-CLAUDE.md> baseline
bash setup-arm.sh $out/arms/treatment ~/dotfiles/claude/CLAUDE.md treatment
bash run-matrix.sh $out baseline 4      # 5 tasks x haiku-low, sonnet-low x 4
bash run-matrix.sh $out treatment 4
bash summary.sh $out/results-*.jsonl
node --test judge-fixtures.test.mjs     # real judge calls, ~2 min
node replay.mjs $out/replay --days 10 --per-group 25
```

Costs (Nov 2026): a matrix is ~$4-6 and ~15 minutes; a judge call is ~$0.015 and 5-12 s.

## Traps found while building it

- Eval runs must keep session persistence on: the judge reads the transcript file, and with
  `--no-session-persistence` there is none, so the judge silently never runs.
- The hooks skip headless (`sdk-*`) runs, so the arms force `CLAUDE_CODE_ENTRYPOINT=cli`.
- An arm whose CLAUDE.md names `skeptical-verifier` must have that agent, or agents report
  "I didn't run the verifier" and the judge sends them back for it.
- A Bash command that edits and then tests (`cat >> x.test.js … && npm test`) is a check after
  the edit; the grader compares positions inside the command.
