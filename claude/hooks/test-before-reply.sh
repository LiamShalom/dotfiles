#!/bin/bash
# Stop: refuse to end a turn whose reply offers to run a test, or says the change is untested, instead of testing it.
# Testing needs no permission (CLAUDE.md "Testing"), so "should I set up a test brand and run it?" is never the right
# end of a turn. 10-29 PR #8024: the Start today reopen link went up with unit tests only and the reply asked to test
# in the browser; "test in browser with the full link. Add to harness for future not to return a response without
# testing fully". Same class as the 10-20/10-21 "test e2e before merging" corrections (learning ledger row 11).
# Blocks once: stop_hook_active lets the second reply through, so a real blocker (a login only Liam has) can be named.
# Runs at every turn end in every session, so it stays at one jq call. Headless runs are skipped (see ask-check.sh).

case "${CLAUDE_CODE_ENTRYPOINT:-}" in "" | sdk*) exit 0 ;; esac
jq -c 'if .stop_hook_active then empty else
  (.last_assistant_message // "") as $m
  | ($m | test("(should|shall|can|may) i (go ahead and )?(set up|create|run|test|verify|try|drive|check|exercise)[^?\\n]{0,120}(test|verif|preview|browser|e2e|end to end|flow)|want me to (set up|run|test|verify|try|drive)[^?\\n]{0,80}(test|verif|preview|browser|flow)|(haven.t|have not|did not|didn.t|couldn.t|could not|not yet) (been )?(tested|verified|run|exercised|opened|driven|browser-verified|proven)[^.\\n]{0,60}(browser|preview|e2e|end to end|real flow|real app)|not (yet )?(browser-)?(verified|proven) (in|on) (a |the )?(browser|preview)|real test on the (pr.s )?preview"; "i")) as $untested
  | if $untested then {decision: "block", reason: "Your reply offers to test, or says the change is untested in the browser. Testing needs no permission: run the real flow now (preview or local server, test account, the exact link or path a user would use), then report what you saw. End the turn without testing only if something outside your reach blocks it, and then name that blocker and the one step Liam must do."} else empty end
end' 2>/dev/null
exit 0
