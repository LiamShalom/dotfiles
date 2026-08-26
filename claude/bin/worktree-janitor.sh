#!/bin/bash
# worktree-janitor.sh — bound disk growth from git worktrees in the SideShift monorepo.
#
# Two leaks, two rules:
#   1. .next build caches grow without bound (one reached 32GB). Deleted when stale.
#   2. Worktrees each carry a full npm node_modules (~1-3GB). Removed when provably dead.
#   3. Worktrees that are NOT dead (open PR / unpushed work) are never removed by rule 2,
#      yet still park a full node_modules forever. At 100+ live worktrees that is the
#      dominant leak (~158GB on 2026-08-19). Their node_modules is dehydrated when idle.
#
# "Provably dead" is decided by GitHub PR state, NOT git merge-ancestry: this repo
# squash-merges, so a shipped branch never becomes an ancestor of main and
# `git branch --merged` finds almost nothing. See docs note in the log header.
#
# Safety rails — a worktree is removed ONLY if ALL hold:
#   - its branch has a MERGED or CLOSED PR (never OPEN, never no-PR/unpushed work)
#   - the working tree is clean
#   - local HEAD is exactly the PR's head commit (no local commits made afterwards)
#   - no running node process has its cwd inside it
# Anything failing a rail is skipped and logged, never deleted.

set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO="${REPO:-$HOME/sideshift-monorepo}"
NEXT_AGE_DAYS="${NEXT_AGE_DAYS:-3}"
IDLE_DAYS="${IDLE_DAYS:-10}"
LOW_DISK_GB="${LOW_DISK_GB:-40}"
DRY_RUN="${DRY_RUN:-0}"

LOG_DIR="$HOME/.claude/logs"
LOG="$LOG_DIR/worktree-janitor.log"
mkdir -p "$LOG_DIR"

# Keep the log bounded: trim to the last 2000 lines on each run.
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 2000 ]; then
  tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

free_gb() { df -g /System/Volumes/Data | awk 'NR==2 {print $4}'; }

run() {
  if [ "$DRY_RUN" = "1" ]; then
    log "  DRY-RUN would: $*"
  else
    "$@" >/dev/null 2>&1
  fi
}

# ---------------------------------------------------------------------------
# Single-instance lock. The 04:00 schedule alone could never overlap, but the
# low-disk guard (worktree-janitor-guard.sh, every 30min) can fire while a run
# is still going. Two concurrent runs would race on `rm -rf` and
# `git worktree remove` over the same paths. mkdir is atomic, so it works as a
# lock without flock (which macOS does not ship).
LOCK_DIR="$HOME/.claude/logs/.worktree-janitor.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +360 2>/dev/null)" ]; then
    log "WARN: stale lock (>6h) — taking it over"
  else
    log "another janitor is already running — exiting"
    exit 0
  fi
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

[ -d "$REPO" ] || { log "FATAL: repo not found at $REPO"; exit 1; }
command -v gh >/dev/null || { log "FATAL: gh not on PATH"; exit 1; }

START_FREE=$(free_gb)
log "=== janitor start (free ${START_FREE}GB, .next age ${NEXT_AGE_DAYS}d, idle ${IDLE_DAYS}d, dry_run=${DRY_RUN}) ==="

cd "$REPO" || exit 1

# Drop registrations for worktrees whose directory is already gone.
run git worktree prune

# ---------------------------------------------------------------------------
# Collect cwds of running node processes so we never yank a live dev server's
# build cache out from under it.
# ---------------------------------------------------------------------------
BUSY=$(lsof -a -c node -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2- | sort -u)

is_busy() {
  local dir="$1"
  [ -n "$BUSY" ] || return 1
  printf '%s\n' "$BUSY" | grep -qF "$dir"
}

# ---------------------------------------------------------------------------
# Pass 1 — stale .next caches
# ---------------------------------------------------------------------------
NEXT_CLEARED=0
while IFS= read -r nd; do
  [ -n "$nd" ] || continue
  wt="$(dirname "$nd")"
  if is_busy "$wt"; then
    log "  skip .next (dev server live): $wt"
    continue
  fi
  sz=$(du -sh "$nd" 2>/dev/null | cut -f1)
  log "  clearing .next ($sz): $wt"
  run rm -rf "$nd"
  NEXT_CLEARED=$((NEXT_CLEARED + 1))
done < <(find "$REPO/.worktrees" "$REPO/.claude/worktrees" \
           -maxdepth 2 -type d -name .next -prune \
           -mtime "+${NEXT_AGE_DAYS}" -print 2>/dev/null)

# ---------------------------------------------------------------------------
# Pass 2 — dehydrate idle worktrees (drop regenerable node_modules)
# ---------------------------------------------------------------------------
# Pass 3 can only remove a worktree that is provably dead, so every worktree with
# an OPEN PR or unpushed work keeps its ~3.3GB node_modules indefinitely. That is
# what actually refills the volume between runs.
#
# Unlike Pass 3 this is safe on dirty worktrees and unpushed branches: node_modules
# is gitignored and holds NO user work. Cost of being wrong is one `npm install`.
# Deliberately no marker file is written inside the worktree — an untracked file
# would make `git status --porcelain` dirty and permanently trip Pass 3's
# cleanliness rail, so the record is kept in this log instead.
DEHYDRATED=0

is_idle() {
  # idle = nothing under the worktree touched within IDLE_DAYS, ignoring
  # generated/vendored dirs. -quit stops at the first hit, so this stays cheap.
  local hit
  hit=$(find "$1" -maxdepth 3 \
          \( -name node_modules -o -name .next -o -name .git \) -prune -o \
          -type f -mtime "-${IDLE_DAYS}" -print -quit 2>/dev/null)
  [ -z "$hit" ]
}

for wt in "$REPO"/.worktrees/*/ "$REPO"/.claude/worktrees/*/; do
  wt="${wt%/}"
  [ -d "$wt" ] || continue
  [ "$wt" = "$REPO" ] && continue
  [ -d "$wt/node_modules" ] || continue

  if is_busy "$wt"; then
    log "  KEEP node_modules (process live inside): $wt"
    continue
  fi
  is_idle "$wt" || continue

  sz=$(du -sh "$wt/node_modules" 2>/dev/null | cut -f1)
  log "  dehydrating node_modules ($sz, idle ${IDLE_DAYS}d+): $wt"
  run rm -rf "$wt/node_modules"
  DEHYDRATED=$((DEHYDRATED + 1))
done

# ---------------------------------------------------------------------------
# Pass 3 — dead worktrees, gated on GitHub PR state
# ---------------------------------------------------------------------------
PR_JSON=$(mktemp)
if ! gh pr list --state all --limit 800 \
      --json headRefName,state,headRefOid,number > "$PR_JSON" 2>/dev/null; then
  log "  WARN: gh pr list failed (offline or auth expired) — skipping worktree pass"
  rm -f "$PR_JSON"
  log "=== janitor done (free $(free_gb)GB, .next cleared: $NEXT_CLEARED, dehydrated: $DEHYDRATED) ==="
  exit 0
fi

WT_LIST=$(mktemp)
git worktree list --porcelain \
  | awk '/^worktree /{wt=$2} /^branch /{sub("refs/heads/","",$2); print wt"\t"$2}' > "$WT_LIST"

REMOVED=0
SKIPPED=0

while IFS=$'\t' read -r wt br; do
  [ -n "$wt" ] || continue
  # Never touch the primary checkout.
  [ "$wt" = "$REPO" ] && continue
  [ -d "$wt" ] || continue

  # --- rail: PR must exist and be merged/closed -----------------------------
  verdict=$(python3 -c "
import json,sys
br=sys.argv[1]
ps=[p for p in json.load(open(sys.argv[2])) if p['headRefName']==br]
if not ps: print('NO_PR|'); sys.exit()
if any(p['state']=='OPEN' for p in ps): print('OPEN|'); sys.exit()
p=sorted(ps,key=lambda x:x['number'])[-1]
print(p['state']+'|'+p['headRefOid'])
" "$br" "$PR_JSON" 2>/dev/null)

  state="${verdict%%|*}"
  pr_sha="${verdict##*|}"

  case "$state" in
    MERGED|CLOSED) ;;
    *) SKIPPED=$((SKIPPED + 1)); continue ;;   # OPEN / NO_PR / unknown -> leave alone
  esac

  # --- rail: working tree must be clean -------------------------------------
  if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
    log "  KEEP (uncommitted changes): $wt [$br]"
    SKIPPED=$((SKIPPED + 1)); continue
  fi

  # --- rail: no local commits beyond what the PR contained ------------------
  head_sha=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
  if [ -n "$pr_sha" ] && [ "$head_sha" != "$pr_sha" ]; then
    log "  KEEP (local commits past PR head): $wt [$br]"
    SKIPPED=$((SKIPPED + 1)); continue
  fi

  # --- rail: nothing running inside it --------------------------------------
  if is_busy "$wt"; then
    log "  KEEP (process live inside): $wt [$br]"
    SKIPPED=$((SKIPPED + 1)); continue
  fi

  sz=$(du -sh "$wt" 2>/dev/null | cut -f1)
  log "  removing worktree ($sz, PR $state): $wt [$br]"
  # Deliberately NOT --force: git re-checks for modifications independently of the
  # cleanliness rail above, so a race or a bug in our check still can't destroy work.
  if [ "$DRY_RUN" = "1" ]; then
    log "  DRY-RUN would: git worktree remove $wt"
  else
    if git worktree remove "$wt" >/dev/null 2>&1; then
      REMOVED=$((REMOVED + 1))
    else
      log "  WARN: git refused to remove $wt — left in place"
    fi
  fi
done < "$WT_LIST"

rm -f "$PR_JSON" "$WT_LIST"

END_FREE=$(free_gb)
log "=== janitor done: .next cleared $NEXT_CLEARED, dehydrated $DEHYDRATED, worktrees removed $REMOVED, kept $SKIPPED ==="
log "=== free ${START_FREE}GB -> ${END_FREE}GB ==="

# Shout if we're still tight after cleaning — that means something new is eating disk.
if [ "$END_FREE" -lt "$LOW_DISK_GB" ] && [ "$DRY_RUN" != "1" ]; then
  log "!!! LOW DISK: only ${END_FREE}GB free after cleanup"
  osascript -e "display notification \"Only ${END_FREE}GB free after worktree cleanup.\" with title \"Disk running low\"" 2>/dev/null
fi
