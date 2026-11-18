# Slack :eyes: follow-ups (a teammate or Liam already answered)

Use when: Liam put :eyes: on a message, but the thread already holds an answer by a SideShift teammate or by
Liam himself, for example a teammate explains the case and writes "no need to claim", or Liam replies to a
question in the thread. Also when a later turn brings new thread messages after you have started.

Facts below were checked in the 2026-11-18 runs. If a tool or field name no longer matches, fix this file
(step 7 of the skill).

## The rule for this topic: read the thread first, post nothing that is already answered

Read the whole thread before any query. On 2026-11-18 a bonus question was answered by a teammate 13 seconds
after the watcher's "taking a look", and the teammate told Liam not to claim it. The right result was `done`
with an empty `reply`. The first return listed the teammate's figures as if they were findings, and the watcher
sent it back because nothing in the session proved them. Attribute a teammate's statement to the thread
("Jadon wrote ...") or check it yourself; never state it as your own fact.

## How to check

- Read: `mcp__slack__slack_read_thread` with `channel_id` and `message_ts` (the thread ts). It returns the
  parent, every reply with author, Slack user id, time and ts, and the parent's files and reactions.
- Who is a teammate: a reply author with a `@sideshift.app` email is internal. The parent author may be
  external (Slack Connect shows the author's company, for example "external: <company>").
- The watcher's first reply ("taking a look") is posted as Liam (U0B78R52DFT). A reply by U0B78R52DFT after
  that is Liam's own answer.

## Symptom to cause to proof

| What the thread shows | What it means | Proof |
| --- | --- | --- |
| A teammate answers the reporter and tells Liam not to claim it | Nothing more for Liam: return `done`, empty `reply`, no queries needed | Reply ts and author in `slack_read_thread` |
| Liam (U0B78R52DFT) answers a question in the thread | The question is closed: add only what is new, or post nothing | Reply ts and author in `slack_read_thread` |
| The teammate's answer is a data claim you may want to repeat | Not proven by the thread alone. Query it (read replica or `postgres_query`) before you put it in `reply` or `summary` as a fact | Your own query result |

## What to reply

- Empty `reply` when someone already answered. Put the reason in `summary` with the reply ts.
- If you add something, add only the part nobody has said, and keep every claim in `unproven_claims` empty
  by proving it first.
- Never speak for the teammate, and never promise what they will do.
