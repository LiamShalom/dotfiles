#!/bin/bash
#
# learning-weekly.sh: run the `correct` skill's weekly pass headless. launchd runs it
# (launchd/com.sideshift.learning.weekly.plist, loaded by install.sh); it can also be
# run by hand. The run may change global config, personal skills and the ledger, and
# commits them to dotfiles (own files only, no push). It opens no repo PRs: those go
# in the ledger as `open` for an interactive session. Report: ~/.claude/logs/learning/.
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

day=$(date +%F)
dir="$HOME/.claude/logs/learning"
report="$dir/weekly-$day.md"
mkdir -p "$dir"

cd "$HOME/dotfiles" || exit 1
claude -p "Run the weekly pass of the \`correct\` skill (load it with the Skill tool first) over the last 7 days.
This is an unattended scheduled run: nobody will answer questions.
- Change only global Claude config, personal skills, hooks and the ledger under ~/dotfiles/claude, and ~/.claude/settings.json for hook registration. Commit your own dotfiles changes (stage only your files or hunks, no push).
- Do not open repo PRs or edit any repo checkout. Record repo-level fixes (lint, CI, test) as ledger rows with status \`open\` and the evidence.
- Anything that would change how the operator works goes in the report as a proposal, not a change.
- Write the report to $report: what you changed (with the dotfiles commit hash), what you proposed, which ledger rows changed status, and skill-usage numbers for the week. Plain sentences, operator-facing." \
  --permission-mode bypassPermissions --max-turns 120 </dev/null >"$dir/weekly-$day.log" 2>&1
rc=$?
echo "$(date '+%F %T') exit=$rc report=$report" >>"$dir/runs.log"
