# Learning ledger

Lessons from the operator's corrections and what enforces each one. Owned by the `correct`
skill (`~/.claude/skills/correct/SKILL.md`), which defines the levels and statuses. A lesson
is only `enforced` once a check was seen failing on the real past mistake.

| date | class | evidence | level | enforced by | status |
|---|---|---|---|---|---|
| 2026-10-21 | Did not open the UI preview in Session Board when UI approval was the only gate left | 10-21 "show me the UI preview, this is in instructions that when waiting on UI approval you automatically open for me" — rule is in `~/.claude/CLAUDE.md` (Merging PRs) and the `quick-fix` Report step | 5 (prose) | nothing | open — repeat while rule loaded |
| 2026-10-21 | Same class, iOS: opened a screenshot folder instead of the simulator, and shut the simulator and rig down before handing over (PR sideshift-mobile #231) | 10-21 "show me the UI preview, this is in instructions that when waiting on UI approval that you automatically open for me to inspect" | 5 → 4 | `quick-fix` Report step: iOS = `--simulator`, keep the rig up, clean up after approval | open — level 4 is still prose; a level-2 Stop hook needs a reliable "waiting on UI approval" signal, not found yet |
| 2026-10-21 | Merged, or asked to merge, before driving the real flow end to end | 10-21 "you already merged so you want to run the real flow now to test e2e"; 10-20 "I need you to ensure that everything has been fully tested e2e … before merging" — rule is `CLAUDE.md` #1 rule and merge rules | 5 (prose) | nothing | open — repeat while rule loaded |
| 2026-10-21 | Unexplained jargon in replies | 10-20 "wdym analytics db pass?", "wdym analytics password rotation?" — rule is `CLAUDE.md` "How to explain things to me" | 5 (prose) | nothing | open — repeat while rule loaded |
| 2026-10-21 | Treated gaps the agent itself listed as out of scope | 10-20 "wdym other gaps. These are all relevant" — memory `every-listed-gap-is-in-scope` | 5 (memory) | nothing | open |
| 2026-10-21 | Opened a PR or merge flow for personal skills that live in dotfiles | 10-20 "no need to open a PR, add these to my personal skills"; "no need to merge, these are my personal skills" | 5 (memory) | `dotfiles-symlinks-into-claude-config` memory | open |
