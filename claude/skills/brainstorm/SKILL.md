---
name: brainstorm
description: "Turn a feature idea into an approved spec for a larger SideShift project: research the codebase, data and product deeply, ask the operator questions one at a time, propose approaches with a recommendation, and write the spec that the design and execute skills build from. Use when the operator says brainstorm, spec it out, architect, scope, or think through a feature before it is built. Replaces the legacy brainstorming + spec flow. Not for bug fixes (use bugfix) or one-file changes."
---

# Brainstorm

The output is one approved spec that another agent can build from with no further questions.
Research first, then ask. A question the code or the data can answer is a wasted question.

The operator's rules stay in force and win over this skill: the repo `CLAUDE.md`,
`~/.claude/CLAUDE.md`, and agent memory.

## Feature folder

Every feature has one folder. The three skills share it:

```
docs/features/YYYY-MM-DD-<slug>/
  spec.md      # this skill
  design.md    # design skill (UI decisions, preview URL, screenshots)
  plan.md      # execute skill
  HANDOFF.md   # execute skill (progress log; not committed)
```

## Steps

1. **Research before the first question.** Do this in parallel with `Explore` subagents for
   big surfaces. Cover:
   - **Code.** The closest shipped flow, its components, hooks, use cases and data writers.
     Do the reuse search the repo `CLAUDE.md` requires. For backend work, start at
     `docs/backend/INDEX.md` and `CATALOG.md`.
   - **Data.** What exists today in Postgres (read replica) and Firestore. Real row counts and
     shapes, not guesses. Who writes each field the feature will read.
   - **Product and history.** Related memory entries, earlier specs in `docs/features/` and
     `docs/superpowers/specs/`, open or closed PRs on the same area (`gh pr list --search`).
   - **External.** For a provider or library, use Context7 for docs. Note real API limits.

   Write the findings into the spec's **Context** section as you go, with file paths.

2. **Check the scope.** If the idea is several independent systems, say so first and propose
   how to split it. Brainstorm the first part; list the others as follow-ups.

3. **Ask questions, one per message.** Before the first one, write two lines at the top of
   the spec: the party whose pain the ask names (the primary party), and the ask's
   distinctive part (step 4). Frame every question from the primary party's screen and
   workflow; other parties come after, as consequences. (11-09 messaging spaces: the ask said
   "for brands the view makes it almost impossible to handle mass creators", and the space
   question was framed around the creator's rail → "this is more focused towards the brand
   side".) Only about what research cannot answer: intent,
   priority, who it is for, what "done" looks like, trade-offs that are product calls. Put
   what you found and your recommended answer in each question so the operator can say
   "yes". Use `AskUserQuestion` when the answer is a choice. Stop when another question would
   not change the spec.

4. **Propose two or three approaches** in prose, with costs and risks. Say which you would
   pick and why. Disagree with the operator when you think the plan is wrong.
   Before you do, write the ask's distinctive part in one line (the thing that makes it this
   idea and not a simpler one: "floats over the other app"). Every approach you offer must keep
   it, at least on the platforms where it is possible. If research says it is impossible
   somewhere, search for the platform's own way to do it before dropping it, and if an
   approach still drops it, say so in the question and ask whether the reduced version is
   what they want. (11-03 connect guide: "a floating step by step guide" became a connect
   sheet; desktop Chrome's Document Picture-in-Picture was missed → "this isnt at all what I
   was thinking".)
   When an approach carries a decision table (rules, recommendations, thresholds, splits),
   tag every cell with its source before you show it: our data (with N), a named outside
   source, or my pick. If the question is "what works for which kind of customer", first
   collect revealed choices at scale: what many real customers chose on competitor platforms
   (public directories, listing APIs, the creator side of a competitor we hold a test login
   for). Benchmarks and blog posts alone are not enough. (11-22 onboarding format table: cells
   mixed our data, benchmarks and my guesses unlabelled → "these arent accurate. Look at trybe
   launchpoint and all competitors"; Trybe's creator directory then gave 9,293 programs.)

5. **Write the spec** to `docs/features/YYYY-MM-DD-<slug>/spec.md` with the template below.
   Then review it yourself: no TBDs, no contradictions, every requirement has one meaning,
   every party in the matrix has an acceptance check.

6. **Get approval.** Show the operator the spec path and a short summary of the decisions.
   Change it until they approve. Commit it on the feature branch.
   Before you show it, tag every decision with its source: `(operator: "<his words>")` only
   when his own message answered it, else `(my pick, unconfirmed)`. A question he skipped or
   answered with "ignore point 2" is unconfirmed, not agreed. List the unconfirmed picks
   first in the approval message, one line each. (11-20 Spotlight pool: "tiers stay" was my
   pick, written as "(Liam, 2026-11-20)" and built → "this is not what we agreed tho".)

7. **Hand off.** Say what comes next:
   - The feature has new or changed UI: run `design` next.
   - No UI: run `execute` next.

## Spec template

```markdown
# <Feature>

**Goal:** one sentence, in user terms.
**Status:** approved YYYY-MM-DD

## Context
What exists today, with file paths and real data. What we reuse.

## Decisions
Each decision, the chosen option, and why. Rejected options in one line each.

## Behavior
What each party sees and can do, step by step. Include empty, loading, error states.

## Party matrix
| Party | Can | Must not | Acceptance check |

## Tracking plan
| Step | Event | Fired where | Key properties |
| 0 exposure | `<feature>_viewed` | client, on first render of the entry point | ... |
| n success | `<feature>_completed` | server, after the write commits | ... |

**Target:** <x>% of exposed users reach step n within 7 days (baseline: <query and number>).
**Guardrail:** `<existing event>` <metric> stays within <y>% of its 14-day pre-launch value.
**Minimum users:** <n> (default 30).
**Postgres outcome (optional):** <table/row that proves the real result>.

## Data and backend
Tables, fields, writers, readers, migrations (a migration is its own PR first), jobs.

## UI surfaces
Each screen or component, its entry point, and the existing component it reuses.

## Out of scope
## Risks and open items
Only items the operator agreed to leave open, each with an owner.
```

## Rules

- A feature that adds or changes a user flow (web, iOS or Android) has a **Tracking plan**.
  Step 0 is an exposure event (who could use it); the success step fires on the server after
  the write when there is one. Reuse an existing event when it already means the step. Measure
  the baseline in PostHog (web project 633691, app project 202481) and propose the target and
  guardrail from it; the operator approves them with the spec. The plan becomes the feature's
  launch watch, which posts day 1/3/7/14 readouts in #feature-launches (`docs/watches.md`).
- No implementation code in this skill. A spike to answer a feasibility question is
  allowed; delete it after and record the answer in the spec.
- No feature flags in the spec unless the operator gives a specific reason.
- No explainer notice blocks in proposed UI.
- A new provider permission goes into the existing connect (OAuth) flow that already asks
  for that provider's permissions, never a separate "Allow" button or consent screen. Only
  an off switch may sit outside it.
- Say what you guessed. A guess in the Context section is marked as a guess.
