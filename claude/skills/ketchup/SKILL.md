---
name: ketchup
description: "Catch the operator up on a chat they left running: what changed since their last message, in plain words, then every decision waiting on them with your pick, the evidence and the risk, so they can decide from the reply alone. Use when the operator comes back and asks 'where are we', 'what happened', 'catch me up', 'status?', 'anything left?', 'so are we all set?', 'is it good to merge?', or for /ketchup. Read-only: it changes nothing."
---

# Ketchup

The operator remembers their last message and nothing after it. Tell them what changed since
then and lay out every call that waits on them, so they can make each one from your reply.
Notifications and subagent results are not their messages.

Keep this turn read-only: no code changes, no jobs, no posts, no merges. Do check the live
state of each PR, CI run, deploy or agent this chat touched (`gh pr view`, `gh pr checks`),
so you report what is true now, not what was true when you last looked. Check every number
against its source, and say so if you correct one.

## Write the reply

**First line:** what waits on the operator, or "Nothing waits on you."

**What happened**, under 100 words: one short bullet per thing they asked for, written the way
you would say it out loud: what came of it, and whether it is done, running, failed, or not
checked. Name any bug found and fixed on the way. Never mark something done that still waits
on them. Leave out work that changed nothing for them, hashes, file paths and test counts.
If the change is visible, open the screenshot or preview in Session Board
(`node ~/session-board/scripts/board-browser.mjs <url | file> "<what to look at>"`), and say
so instead of describing the screen.

**What waits on you**: one bullet per call only the operator can make (merge, approve a UI,
a product choice, a sign-in, anything that spends money or cannot be undone). Each bullet:
the call, your pick, what it changes for users, the evidence, and the risk, even when low
("Low risk: copy only"). Give the PR number or link. When several items share a call, state
the call and your pick once, then one bullet per item, riskiest first. For a choice between
options, give each option's gain and cost. Work you can still do yourself is not a call;
name it in one line at the end.

Never invent a call to fill the reply, and never cut a real one to stay short.
