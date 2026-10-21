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

3. **Ask questions, one per message.** Only about what research cannot answer: intent,
   priority, who it is for, what "done" looks like, trade-offs that are product calls. Put
   what you found and your recommended answer in each question so the operator can say
   "yes". Use `AskUserQuestion` when the answer is a choice. Stop when another question would
   not change the spec.

4. **Propose two or three approaches** in prose, with costs and risks. Say which you would
   pick and why. Disagree with the operator when you think the plan is wrong.

5. **Write the spec** to `docs/features/YYYY-MM-DD-<slug>/spec.md` with the template below.
   Then review it yourself: no TBDs, no contradictions, every requirement has one meaning,
   every party in the matrix has an acceptance check.

6. **Get approval.** Show the operator the spec path and a short summary of the decisions.
   Change it until they approve. Commit it on the feature branch.

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

## Data and backend
Tables, fields, writers, readers, migrations (a migration is its own PR first), jobs.

## UI surfaces
Each screen or component, its entry point, and the existing component it reuses.

## Out of scope
## Risks and open items
Only items the operator agreed to leave open, each with an owner.
```

## Rules

- No implementation code in this skill. A spike to answer a feasibility question is
  allowed; delete it after and record the answer in the spec.
- No feature flags in the spec unless the operator gives a specific reason.
- No explainer notice blocks in proposed UI.
- Say what you guessed. A guess in the Context section is marked as a guess.
