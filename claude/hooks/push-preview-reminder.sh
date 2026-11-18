#!/bin/bash
# PostToolUse(Bash): after a `git push` in a SideShift repo, tell the agent at the moment of the push to open the
# updated preview for the operator in the same turn. A memory rule (open-preview-after-every-change, 10-27) was loaded
# and still missed on 10-29 (#7777: a header fix and an icon revert went up with no preview; "open the preview after
# every change", learning ledger).
# Runs after every Bash call in every session, so it stays at one jq call.
jq -c '(.tool_input.command // "") as $c | (.cwd // "") as $d
  | if ($c | test("(^|[;&|[:space:]])git( -C [^ ]+)? push\\b")) and ($d | test("sideshift-(monorepo|mobile)"))
    then (if env.CLAUDE_CODE_ENTRYPOINT == "claude-desktop" then "in the desktop app'"'"'s browser pane (mcp__Claude_Browser__preview_start; a simulator: mcp__Claude_Code_iOS_Simulator__control attach)" else "with board-browser.mjs" end) as $how
    | {hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: "You pushed. If this push changes anything a user sees, do not end the turn yet: wait for this commit'"'"'s preview build (or rebuild the simulator), open it on the changed screen \($how), screenshot that tab, and say where it is. No UI change: ignore this."}}
    else empty end' 2>/dev/null
exit 0
