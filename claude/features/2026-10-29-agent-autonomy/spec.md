# Agent autonomy: decide more, ask less

**Goal:** agents on every model make the decisions Liam would make, tell him afterwards, and
stop to ask only when the answer truly needs him, so each task costs fewer round trips and can
run on cheaper models.
**Status:** approved 2026-10-29 (answers to the three brainstorm questions); spec awaiting final read

## Context

Measured from every main-session transcript modified 2026-10-22 → 10-29
(`~/.claude/projects/*/*.jsonl`, subagent turns left out). The script used is in the
Appendix; the execute step turns it into `claude/bin/ask-rate`.

- **Model mix.** About 7,524 of Liam's messages followed an Opus turn and 354 followed a Sonnet
  turn. Haiku main sessions: none. Model weights cannot be trained here. The harness and the
  context are the only levers.
- **Ask rate.** 1,762 of the 7,524 (23%) came right after an agent message that asked him
  something (wide regex: "want me to", "should I", "let me know", "your call", …). There were also
  245 `AskUserQuestion` calls.
- **Asks that carried a pick.** 440 agent messages said "my pick / I recommend / I'd pick".
  Liam's reply:
  - 102 plain accepts ("execute", "go ahead", "go with your picks", "merge 7522"). 42 of them
    were merge OKs.
  - 12 ignored the ask and asked for the preview to be opened or for a sign-in. Both are
    standing rules already (memory `open-preview-after-every-change`, ledger row 2026-10-28).
  - 18 were confusion ("wdym", "im confused").
  - 308 were something else. In a 45-pair sample these split into: product meaning the agent
    could not know ("this has no creator involvement", "they shouldnt be influencer", "C"); a
    redirect to other work, so the ask did not matter; and things the agent could do itself
    ("you should be able to do so since I have the login").
- **Every turn costs the whole context again.** AGENTS.md "Token economy": cached input is
  $0.20/M on Opus and on Sonnet, output is $20/M on Opus and $10/M on Sonnet. A stop-and-wait
  turn costs a full context re-read and the latency of Liam's attention.
- **Existing machinery to reuse:**
  - `claude/hooks/ask-check.sh`. A Stop hook with one jq pass that already detects asks and
    adds one continuation (`stop_hook_active` guard, skips `sdk-*`). The new check goes into
    the same pass.
  - `claude/hooks/correction-nudge.sh` and `~/.claude/logs/corrections-flagged.log`. They
    detect corrections, so they serve as the quality signal.
  - `claude/learning/ledger.md` (58 rows) and the `correct` skill's weekly pass. Distilled
    precedent comes from here.
  - `claude/references/ui-taste.md`. This is the existing model for "a reference file built
    from Liam's dated quotes, read at decision time, updated after each reaction". The
    decisions file copies that pattern.
  - `claude/hooks/merge-reach-check.sh`. This is the merge-time gate. It stays.

## Decisions

1. **Decide-and-tell authority (Liam, 2026-10-29: all four).** The agent decides these, acts,
   and reports the decision afterwards:
   - a choice between options when it has a pick and the result can be undone (approach,
     values, one PR or two, A/B/C);
   - scope add-ons on the same surface (a fix or follow-up it found);
   - anything a standing rule already settles (open the preview, sign in, use a saved login,
     run the test, clean up test data);
   - merging **medium** feature PRs after full end-to-end proof. Medium means one product area,
     no new integration or product area, no large UI (CLAUDE.md definition), and all checks
     green. Large features and large UI still need Liam's explicit OK.
2. **Ambiguous meaning: assume if cheap to redo (Liam, 2026-10-29).** The agent picks the most
   likely meaning and keeps building when a wrong guess costs only branch code. It asks first
   when a wrong guess means a large rebuild (more than about one feature's worth of work), or
   would reach customers, production data, money or another person.
3. **Model rollout: phase it, measure first (Liam, 2026-10-29).** Week 1 adds the rules,
   precedent and hook on the current models and records a baseline. Week 2 moves
   `execute` and `quick-fix` sessions to Sonnet. Opus is kept for diagnosis, design and
   brainstorm. Liam's correction rate is the quality signal, and a rise rolls Week 2 back.
4. **UI options no longer block.** This reconciles decision 1 with ledger row 2026-10-23
   (options for new screens). The agent still builds 2–3 directions, then builds its pick on the
   preview with the others behind the switcher and keeps going. Liam's approval is still needed
   before a large-UI merge, so he reacts to a built screen and does not have to answer a question.
5. **Enforce with a hook, not with prose alone.** The ledger shows that prose-only rules repeat
   (rows 10-21, 10-22, 10-27). The ask-limiting rule therefore lives in `ask-check.sh`.
   - Rejected: CLAUDE.md prose only. It is the cheapest option, but the ledger proves it fails.
   - Rejected for now: a Haiku "Liam stand-in" that answers asks before they reach him. Each
     ask would cost an extra agent, and it would produce confident wrong guesses on exactly the
     product-meaning asks that need Liam. Revisit after the Week 2 numbers.

## Behavior

**What changes for Liam**
- Reports open with a short **Decided** block when the agent made calls on its own. Each line
  is one decision with its reason and an undo, for example "Decided: tiles layout (B), it
  matches Video Reviews thumbnails. Say 'A' to swap." No question mark, no wait.
- Reports open with an **Assumed** line when the agent built on a guessed meaning, for example
  "Assumed: 'your own assets' = brand-made, no creator. Say if you meant creator-made."
- A real ask (see "Must ask" below) still comes as today, checked by the existing ask-check
  rules: what it is, why it matters, and the agent's pick.
- Medium feature PRs arrive already merged, with proof. The report says "merged" and links
  the proof pack.

**Must ask (the only stops)**
1. Real money: spend, charges, payouts, paid tiers (CLAUDE.md testing rule).
2. Large UI approval before merge, and any large feature merge.
3. Irreversible or outward actions on real customers, production data or other people: a
   message to a real person, deleting real data, another person's migration.
4. Ambiguous meaning where a wrong guess is expensive (Decision 2).
5. A fact only Liam has: a login that 1Password does not hold, a code, an account choice.

**Hook flow (Stop, inside `ask-check.sh`'s single jq pass)**
- The hook fires when the final message has a pick ("my pick", "I recommend", "I'd pick",
  "I'd go with") together with ask phrasing, **and** has no must-ask marker (money/spend/charge,
  "large", "approve the UI", real customer/creator/brand names in a send or delete context,
  "migration" with "another"/"someone else's", login/code/password requests).
- Continuation text: "This ask is within your authority (see CLAUDE.md Autonomy): take your
  pick, keep working, and list it under Decided in your next report. If it is a must-ask, reply
  exactly \"Must ask: <which of the 5>\"."
- The hook continues at most once (`stop_hook_active`). It is silent for headless `sdk-*` runs.
  Each hit is logged to `~/.claude/logs/ask-gate.log` with a timestamp and the first 300 chars
  of the message.
- The existing ask-check continuations still apply. If both fire, both texts are joined, as today.

**Precedent file: `claude/references/decisions.md`**
- About 20 principles, each with dated quotes of Liam's own answers. Examples from the data:
  "brands' own assets involve no creator"; "when I gave a login, use it"; "merge into one PR,
  then preview all paths"; "go with your picks". Built first from the 440 pick-asks plus the
  ledger, using the same format as `ui-taste.md`.
- When it is read: CLAUDE.md Autonomy points to it, and `execute`, `quick-fix`, `brainstorm`
  and `design` read it at their first decision point. Every Sonnet/Haiku subagent brief that
  carries a decision includes the relevant lines.
- Kept current: the `correct` skill's weekly pass appends that week's new answers to it. Each
  time Liam overrides a Decided or Assumed line, that is a precedent entry, written in the same
  turn as the in-session `correct` step.

**Measurement: `claude/bin/ask-rate`**
- `ask-rate [--days 7] [--model X]` prints, per model, the human turns, the asks per 100 turns,
  plain-accept rate, corrections per 100 turns (from `corrections-flagged.log` by date window)
  and Decided-line overrides.
- Baseline (2026-10-22 → 10-29, Opus): 23 asks per 100 human turns; 102/440 plain accepts of
  pick-asks. The corrections baseline is computed in the first run.

**Week 2 switch**
- `execute` and `quick-fix` start their build work on Sonnet. The exact mechanism (skill
  frontmatter `model:`, or the skill telling the main session to delegate every build step to
  `model: sonnet` agents) is checked with the Claude Code docs during execute. The mechanism
  that works is used.
- The switch is rolled back when Sonnet sessions show more corrections per 100 turns than the
  Week 1 Opus baseline by more than 25% over at least 150 human turns.

## Party matrix

| Party | Can | Must not | Acceptance check |
|---|---|---|---|
| Main agent (any model) | Decide the four authority classes, assume cheap meanings, merge medium features after proof | Ask about an authority-class decision; act on a must-ask without Liam | Replay 10 real pick-asks from the sample (e.g. "Say 'execute' and I'll start", "go with 30 seconds" ask, "Should I build it?"): hook fires on each. Replay 5 must-asks (the $1–5 ad extension, the Avail influencer-sync large-feature merge, Slack bot token, ad spend, real-creator DM): hook silent on each |
| Liam | Override any Decided/Assumed line in one message | Be asked something a standing rule settles | `ask-rate` one week after rollout shows asks per 100 turns below the 23 baseline, and corrections per 100 turns not above baseline |
| Subagents (Sonnet/Haiku) | Get the relevant precedent lines in their brief | Ask the main agent questions the brief's precedent answers | Next execute run: every subagent brief that carries a choice quotes `decisions.md` lines (checked by reading the briefs in the transcript) |
| Headless runs (`sdk-*`) | Unchanged | Get continuations | Hook replay with `CLAUDE_CODE_ENTRYPOINT=sdk-cli`: silent |
| Weekly `correct` pass | Append new precedents, report `ask-rate` | Rewrite principles without a dated quote | Weekly output contains the ask-rate table and the new precedent count |

## Data and backend

No database, no migration. Everything is files in `~/dotfiles/claude` (symlinked into
`~/.claude`), committed to dotfiles, not pushed (memory `dotfiles-symlinks-into-claude-config`).

- Edit `claude/CLAUDE.md`: a new "Autonomy" section (authority classes, the five must-asks,
  the Decided/Assumed report lines, a pointer to `references/decisions.md`). Widen "Merging PRs"
  to medium features with proof. Keep the large-feature and large-UI rules word for word.
- Edit `claude/hooks/ask-check.sh`: add the pick-without-must-ask test to the existing jq pass,
  and add the log line.
- Add `claude/references/decisions.md`.
- Add `claude/bin/ask-rate`, built from the Appendix script.
- Edit `claude/skills/correct/SKILL.md` weekly step: run `ask-rate`, and append precedents.
- Edit `execute`, `quick-fix`, `brainstorm` and `design` SKILL.md: read `decisions.md` at the
  first decision point. `design` step 7: build the pick, don't wait (Decision 4).
- Week 2: change the model routing for `execute` / `quick-fix`.
- Append a ledger row: "agents ask what they could decide", level 2, enforced by the hook.

## UI surfaces

None. No product UI.

## Out of scope

- Fine-tuning or any model-weight training.
- A Haiku stand-in that answers asks for Liam (revisit after Week 2).
- Changing what counts as large UI or a large feature.
- Codex sessions (`~/.codex/AGENTS.md`). This can follow if the numbers hold.

## Risks and open items

- **The hook regex misreads a must-ask as optional.** Mitigation: the must-ask marker list is
  wide, and the agent can answer "Must ask: N" to keep its ask. The replay set above is the
  test. Owner: execute agent.
- **Merging medium features without Liam broadens what can reach production unseen.**
  Mitigation: `merge-reach-check.sh` still asks its questions at the first merge, and proof is
  still required. Owner: Liam, who chose it on 2026-10-29.
- **The Week 2 model mechanism is not verified yet.** Owner: execute agent, via Context7 /
  `claude-code-guide`, before Week 2.

## Appendix: measurement script used for the baseline

The pick-ask counter was run with `python3 -I` over transcripts with mtime in the last 7 days:
pick regex `my pick|i recommend|i'd pick|my recommendation` on the last 1,500 chars of the
final assistant text before a human message. Accept regex: a leading
`y|yes|ok|sure|go|go ahead|do it|proceed|execute|approved|lgtm|ship it|merge…|go with your picks`.
Tool-result turns, sidechains and recompact-summary turns are skipped.
