# Token economy (API billing)

Claude Code usage is billed per token. Spend tokens where they buy quality and nowhere else.
These rules never override verification, "finish the job", or safety rules: a cheap wrong
answer that needs a redo costs more than one right answer. Judge cost per finished task.

## What a token costs (per 1M, gateway models; checked 2026-10-24)

| Alias | Model | Input | Output | Cache read |
|---|---|---|---|---|
| `haiku` | Haiku 5.5 | $0.10 | $0.50 | — (prompts over 100K cost 5x) |
| `sonnet` | Sonnet 5.5 | $2 | $10 | $0.20 |
| `opus` | Opus 5.5 (main session) | $4 | $20 | $0.20 |
| `fable` | Fable 5.1 | $10 | $50 | — |

Two consequences:
- Output and thinking are the expensive tokens. Moving work from Opus to Sonnet halves them;
  to Haiku cuts them ~40x.
- The whole context is re-read on every turn. Each file, log or screenshot you pull into the
  main session is paid again on every later turn. Keeping the main context small is the
  largest saving, and it costs no quality.

## Route work to the cheapest model that does it well

The main session stays on Opus: it owns judgment, the plan, and the final check. Delegate
with the Agent tool's `model` parameter. Subagents default to `sonnet` (set in settings).

- **`haiku`**: finding and reading. Locate code, sweep many files or logs, summarize a long
  output, answer "where is X / which files do Y", collect facts from a data source. Keep its
  input under 100K tokens.
- **`sonnet`** (default): well-specified execution. Implement a step from a clear plan, write
  or fix tests, mechanical refactors, docs, run a verification recipe, review a diff for one
  named concern.
- **`opus`**: pass it only for work that needs real judgment: ambiguous bugs, design and
  architecture, money/auth/payout paths, schema migrations, messaging compatibility,
  security, and anything a cheaper agent already got wrong.
- **`fable`**: never, unless the user asks for it.

Rules that keep quality while delegating down:
- **Brief the cheap model completely.** Its main failure is missing context, not missing
  intelligence. Give it the goal, exact files, what you ruled out, and what "done" means.
- **Ask for the conclusion, not the dump**: findings with `file:line`, a short diff summary,
  test output tail.
- **Check what comes back before you rely on it.** Spot-check one claim, or run the test.
- **Escalate, do not retry.** If a cheaper agent's result is wrong or shallow, redo that piece
  one tier up, not again at the same tier.
- **Do not delegate a few tool calls.** A subagent starts with ~50K tokens of system prompt
  (measured 2026-10-24: ~$0.13 on Sonnet, ~$0.25 on Opus, ~$0.01 on Haiku, before any work).
  Delegate when it keeps more than ~20K tokens of reading out of the main context, or when
  the pieces can run in parallel.
- Keep fan-out small: 1–3 agents. Ask before a Workflow or anything larger.

## Keep the main context small

- Search before you read (Grep/Glob), then read only the range you need (`offset`/`limit`).
  Do not read a file again that is already in context, unless it changed.
- Cap command output: `head`/`tail`, `--quiet`, `jq` to select fields, `--stat` before a full
  diff, `gh ... --json <fields>`, targeted test files instead of the full suite while iterating.
- Prefer a text snapshot of a page to a screenshot. Take a screenshot only when appearance
  is the thing being checked.
- Edit existing files with Edit, not a full-file Write.

## Think and write in proportion

- Think hard on hard steps (diagnosis, design, risky changes). Do not deliberate over routine
  steps: a lookup, a rename, a status check.
- Replies: lead with the result. No restating the request, no recap of steps the user saw, no
  closing summary of the summary. Brief and complete beats long.
