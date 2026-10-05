#!/bin/bash
# worktree-janitor.sh — bound disk growth from git worktrees in the SideShift monorepo.
#
# Two leaks, two rules:
#   1. .next build caches grow without bound (one reached 32GB). Deleted when stale.
#   2. Worktrees each carry a full npm node_modules (~1-3GB). Removed when provably dead.
#   3. Worktrees that are NOT dead (open PR / unpushed work) are never removed by rule 2,
#      yet still park a full node_modules forever. At 100+ live worktrees that is the
#      dominant leak (~158GB on 2026-08-19). Their node_modules is dehydrated when idle.
#   4. Under disk pressure (free < PRESSURE_GB), every .next not served by a running
#      Next process, plus Xcode DerivedData and app-updater caches (pass 5).
#
# "Provably dead" is decided by GitHub PR state, NOT git merge-ancestry: this repo
# squash-merges, so a shipped branch never becomes an ancestor of main and
# `git branch --merged` finds almost nothing. See docs note in the log header.
#
# Safety rails — a worktree is removed ONLY if ALL hold:
#   - its branch has a MERGED or CLOSED PR (never OPEN, never no-PR/unpushed work)
#   - local HEAD is the PR's head commit or behind it (no local-only commits)
#   - nothing in it was modified in the last ACTIVE_MINUTES (a session may still be in it)
#   - no running process of any kind has its cwd inside it
# Uncommitted changes do not block removal: they are archived first to
# ~/.claude/worktree-archive/ (patch + untracked files), and removal is refused if the
# archive fails. Anything failing a rail is skipped and logged, never deleted.
#
# Pass 3c covers worktrees pass 3 cannot match by branch name. It finds the PR by HEAD
# commit, and it keeps the branch (a detached HEAD is saved under refs/archive/worktrees/).
#
# MODE=merged runs only the merged-PR passes (launchd every 15 min, so a worktree goes
# soon after its PR merges). MODE=full (default) runs every pass. MODE=idle runs the
# merged-PR pass, then retires EVERY worktree idle RETIRE_DAYS+ whatever its PR state
# (run by hand; see pass 3b).

set -uo pipefail

export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

REPO="${REPO:-$HOME/sideshift-monorepo}"
GH_REPO="${GH_REPO:-SideShiftApp/sideshift-monorepo}"
MODE="${MODE:-full}"
NEXT_AGE_DAYS="${NEXT_AGE_DAYS:-3}"
IDLE_DAYS="${IDLE_DAYS:-10}"
ACTIVE_MINUTES="${ACTIVE_MINUTES:-30}"
RETIRE_DAYS="${RETIRE_DAYS:-14}"
NPX_AGE_DAYS="${NPX_AGE_DAYS:-14}"
LOW_DISK_GB="${LOW_DISK_GB:-40}"
# Below this, pass 1 ignores NEXT_AGE_DAYS and pass 5 clears machine-wide build
# caches. On 2026-10-01 the janitor ran at 22GB free and recovered nothing: 57GB
# sat in a fresh main-checkout .next, Xcode DerivedData and updater caches.
PRESSURE_GB="${PRESSURE_GB:-80}"
# Under pressure, pass 2 dehydrates node_modules idle this long instead of IDLE_DAYS.
PRESSURE_IDLE_DAYS="${PRESSURE_IDLE_DAYS:-1}"
# Pass 3c: a worktree whose HEAD is on main looks the same as one an agent has just
# cut from main, so it must sit idle this long first.
MAIN_IDLE_HOURS="${MAIN_IDLE_HOURS:-24}"
# Pass 5: newest SideShift dependency-cache keys kept under pressure.
DEP_CACHE_KEEP="${DEP_CACHE_KEEP:-2}"
DRY_RUN="${DRY_RUN:-0}"
ARCHIVE_DIR="$HOME/.claude/worktree-archive"

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
log "=== janitor start (mode ${MODE}, free ${START_FREE}GB, .next age ${NEXT_AGE_DAYS}d, idle ${IDLE_DAYS}d, dry_run=${DRY_RUN}) ==="

cd "$REPO" || exit 1

# Drop registrations for worktrees whose directory is already gone.
run git worktree prune

# Every registered worktree, wherever it lives (~/sideshift-worktrees, /private/tmp,
# ~/.worktrees-verify, ...). Scanning only .worktrees/ and .claude/worktrees/ once
# let 80GB of caches outside them pile up unseen (2026-09-23).
ALL_WT=$(git worktree list --porcelain | awk '/^worktree /{print substr($0, 10)}')

# Passes 1 and 2 walk this list; other modes empty it.
CACHE_WT="$ALL_WT"
[ "$MODE" = "full" ] || CACHE_WT=""

# ---------------------------------------------------------------------------
# Collect cwds of running processes so we never yank a live dev server's build
# cache, or an agent session's worktree, out from under it. Every process, not
# only `node`: Claude Code runs as a binary named after its version (e.g.
# "2.1.285"), and a shell left in a worktree counts too.
# ---------------------------------------------------------------------------
BUSY=$(lsof -a -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2- | sort -u)

# The worktree a busy cwd belongs to: the LONGEST registered path containing it.
# A substring match would let `google-batch-backend` mark `google-batch` busy, and
# any process in a nested .worktrees/* worktree mark the main checkout busy.
BUSY_WT=$(
  printf '%s\n' "$BUSY" | while IFS= read -r cwd; do
    [ -n "$cwd" ] || continue
    printf '%s\n' "$ALL_WT" | while IFS= read -r wt; do
      case "$cwd" in ("$wt"|"$wt"/*) printf '%s\t%s\n' "${#wt}" "$wt" ;; esac
    done | sort -rn | head -1 | cut -f2
  done | sort -u
)

is_busy() {
  [ -n "$BUSY_WT" ] || return 1
  printf '%s\n' "$BUSY_WT" | grep -qxF "$1"
}

# A .next is in use only while a Next process runs from that worktree. is_busy is
# too broad for it: agent sessions keep a shell in the main checkout all day.
NEXT_CWDS=$(
  for pid in $(pgrep -f 'next(-server| dev| build| start)' 2>/dev/null); do
    lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2-
  done | sort -u
)

next_busy() {
  [ -n "$NEXT_CWDS" ] || return 1
  printf '%s\n' "$NEXT_CWDS" | while IFS= read -r cwd; do
    case "$cwd" in ("$1"|"$1"/*) echo y ;; esac
  done | grep -q y
}

PRESSURE=0
[ "$START_FREE" -lt "$PRESSURE_GB" ] && PRESSURE=1

# ---------------------------------------------------------------------------
# Pass 1 — stale .next caches
# ---------------------------------------------------------------------------
# Includes the main checkout: its .next reached 29GB, the largest single item.
NEXT_CLEARED=0
while IFS= read -r wt; do
  [ -d "$wt/.next" ] || continue
  nd="$wt/.next"
  if [ "$PRESSURE" = "0" ]; then
    [ -n "$(find "$nd" -maxdepth 0 -mtime "+${NEXT_AGE_DAYS}" 2>/dev/null)" ] || continue
  fi
  if next_busy "$wt"; then
    log "  skip .next (dev server live): $wt"
    continue
  fi
  sz=$(du -sh "$nd" 2>/dev/null | cut -f1)
  log "  clearing .next ($sz): $wt"
  run rm -rf "$nd"
  NEXT_CLEARED=$((NEXT_CLEARED + 1))
done <<< "$CACHE_WT"

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
# On 2026-10-04 (16GB free) no worktree was 10 days idle, but four untouched for 1-3
# days held node_modules.
DEHYDRATE_DAYS="$IDLE_DAYS"
[ "$PRESSURE" = "1" ] && DEHYDRATE_DAYS="$PRESSURE_IDLE_DAYS"

is_idle() {
  # idle = nothing under the worktree touched within DEHYDRATE_DAYS, ignoring
  # generated/vendored dirs. -quit stops at the first hit, so this stays cheap.
  local hit
  hit=$(find "$1" -maxdepth 3 \
          \( -name node_modules -o -name .next -o -name .git \) -prune -o \
          -type f -mtime "-${DEHYDRATE_DAYS}" -print -quit 2>/dev/null)
  [ -z "$hit" ]
}

while IFS= read -r wt; do
  [ -d "$wt" ] || continue
  # The main checkout is always in use and is the source other worktrees clone from.
  [ "$wt" = "$REPO" ] && continue
  [ -d "$wt/node_modules" ] || continue

  if is_busy "$wt"; then
    log "  KEEP node_modules (process live inside): $wt"
    continue
  fi
  is_idle "$wt" || continue

  sz=$(du -sh "$wt/node_modules" 2>/dev/null | cut -f1)
  log "  dehydrating node_modules ($sz, idle ${DEHYDRATE_DAYS}d+): $wt"
  run rm -rf "$wt/node_modules"
  DEHYDRATED=$((DEHYDRATED + 1))
done <<< "$CACHE_WT"

# ---------------------------------------------------------------------------
# Pass 5 — machine-wide build and updater caches (full mode, under pressure only)
# ---------------------------------------------------------------------------
# All regenerable. DerivedData (34GB on 2026-10-01) costs one slow Xcode build, so
# it is left alone while Xcode or xcodebuild runs. ShipIt dirs are leftover app
# update downloads.
CACHES_CLEARED=0
if [ "$MODE" = "full" ] && [ "$PRESSURE" = "1" ]; then
  if pgrep -xq Xcode || pgrep -xq xcodebuild; then
    log "  skip DerivedData (Xcode running)"
  else
    for d in "$HOME/Library/Developer/Xcode/DerivedData"/*; do
      [ -e "$d" ] || continue
      log "  clearing DerivedData ($(du -sh "$d" 2>/dev/null | cut -f1)): $(basename "$d")"
      run rm -rf "$d"
      CACHES_CLEARED=$((CACHES_CLEARED + 1))
    done
    # iOS agents pass -derivedDataPath next to their worktrees (two 9.5GB dirs in
    # ~/sideshift-worktrees on 2026-10-04). A DerivedData dir is recognised by its
    # ModuleCache.noindex and info.plist, never by name.
    while IFS= read -r d; do
      [ -n "$d" ] || continue
      log "  clearing loose DerivedData ($(du -sh "$d" 2>/dev/null | cut -f1)): $d"
      run rm -rf "$d"
      CACHES_CLEARED=$((CACHES_CLEARED + 1))
    done <<< "$(printf '%s\n' "$ALL_WT" | while IFS= read -r wt; do dirname "$wt"; done | sort -u \
                | while IFS= read -r root; do
                    find "$root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null \
                      | while IFS= read -r c; do
                          [ -d "$c/ModuleCache.noindex" ] && [ -f "$c/info.plist" ] && printf '%s\n' "$c"
                        done
                  done)"
    # XCTest parallel-testing clones (5.6GB) and simulators for removed runtimes. The
    # Command Line Tools xcrun has no simctl, so point it at Xcode.
    xct_kb=$(du -sk "$HOME/Library/Developer/XCTestDevices" 2>/dev/null | cut -f1)
    if [ -d /Applications/Xcode.app ] && [ "${xct_kb:-0}" -gt 1048576 ]; then
      log "  clearing XCTest simulator clones ($(du -sh "$HOME/Library/Developer/XCTestDevices" 2>/dev/null | cut -f1))"
      run env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun simctl --set testing delete all
      run env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun simctl delete unavailable
      CACHES_CLEARED=$((CACHES_CLEARED + 1))
    fi
  fi
  # uv waits on its cache lock, so a live uv would stall the janitor while it holds its own lock.
  if command -v uv >/dev/null && [ -d "$HOME/.cache/uv" ] && ! pgrep -xq uv; then
    log "  clearing uv cache ($(du -sh "$HOME/.cache/uv" 2>/dev/null | cut -f1))"
    run uv cache clean
    CACHES_CLEARED=$((CACHES_CLEARED + 1))
  fi
  # sideshift-setup keeps a full node_modules per lockfile key and its own policy keeps
  # 3; a key from a superseded lockfile only serves old branches. Keys touched in the
  # last day are kept too, because a clone from one may be in progress.
  DEP_CACHE="$HOME/.cache/sideshift/node-modules"
  if [ -d "$DEP_CACHE" ]; then
    while IFS= read -r d; do
      [ -n "$d" ] || continue
      [ -n "$(find "$d" -maxdepth 0 -mtime +1 2>/dev/null)" ] || continue
      log "  clearing old dependency cache ($(du -sh "$d" 2>/dev/null | cut -f1)): $(basename "$d")"
      run rm -rf "$d" "$d.lock"
      CACHES_CLEARED=$((CACHES_CLEARED + 1))
    done <<< "$(find "$DEP_CACHE" -mindepth 1 -maxdepth 1 -type d -exec stat -f '%m %N' {} + 2>/dev/null \
                | sort -rn | tail -n +$((DEP_CACHE_KEEP + 1)) | cut -d' ' -f2-)"
  fi
  for d in "$HOME"/Library/Caches/*.ShipIt "$HOME/Library/Caches/@lineardesktop-updater" \
           "$HOME/Library/Caches/org.swift.swiftpm" "$HOME/Library/Caches/ffmpeg-static-nodejs"; do
    [ -e "$d" ] || continue
    log "  clearing cache ($(du -sh "$d" 2>/dev/null | cut -f1)): $d"
    run rm -rf "$d"
    CACHES_CLEARED=$((CACHES_CLEARED + 1))
  done
fi

# ---------------------------------------------------------------------------
# Pass 3 — dead worktrees, gated on GitHub PR state
# ---------------------------------------------------------------------------
WT_LIST=$(mktemp)
git worktree list --porcelain \
  | awk '/^worktree /{wt=$2} /^branch /{sub("refs/heads/","",$2); print wt"\t"$2}' > "$WT_LIST"

# PR state per worktree branch, asked of GitHub by branch name. A `gh pr list
# --limit 800` window once hid every PR older than ~#4777, so merged worktrees
# from before it read as "no PR" and were kept forever.
# Output lines: worktree <TAB> branch <TAB> state <TAB> PR head sha.
PR_STATE=$(mktemp)
if ! python3 - "$WT_LIST" "$GH_REPO" > "$PR_STATE" 2>/dev/null <<'PY'
import json, subprocess, sys
rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if "\t" in l]
owner, name = sys.argv[2].split("/")
for i in range(0, len(rows), 40):
    chunk = rows[i:i + 40]
    fields = "".join(
        f'b{j}: pullRequests(headRefName: {json.dumps(br)}, first: 20, '
        f'orderBy: {{field: CREATED_AT, direction: DESC}}) '
        f'{{ nodes {{ number state headRefOid }} }} '
        for j, (_, br) in enumerate(chunk))
    q = f'query {{ repository(owner: "{owner}", name: "{name}") {{ {fields} }} }}'
    out = subprocess.run(["gh", "api", "graphql", "-f", f"query={q}"],
                         capture_output=True, text=True, check=True).stdout
    repo = json.loads(out)["data"]["repository"]
    for j, (wt, br) in enumerate(chunk):
        ps = repo[f"b{j}"]["nodes"]
        if not ps:
            state, sha = "NO_PR", ""
        elif any(p["state"] == "OPEN" for p in ps):
            state, sha = "OPEN", ""
        else:
            p = max(ps, key=lambda p: p["number"])
            state, sha = p["state"], p["headRefOid"]
        print(f"{wt}\t{br}\t{state}\t{sha}")
PY
then
  log "  WARN: PR lookup failed (offline or auth expired) — skipping worktree pass"
  rm -f "$WT_LIST" "$PR_STATE"
  log "=== janitor done (free $(free_gb)GB, .next cleared: $NEXT_CLEARED, dehydrated: $DEHYDRATED) ==="
  exit 0
fi

# Touched recently = a session may still be working in it. Covers edits anywhere in
# the tree plus commits/checkouts (the worktree's reflog). Not the index: any
# `git status`, including this script's own, rewrites it.
recently_active() {
  local gd hit mins="${2:-$ACTIVE_MINUTES}"
  gd=$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null)
  hit=$(find "$1" \( -name node_modules -o -name .next -o -name .git \) -prune -o \
          -type f -mmin "-${mins}" -print -quit 2>/dev/null)
  [ -z "$hit" ] && [ -n "$gd" ] && \
    hit=$(find "$gd/HEAD" "$gd/logs/HEAD" -mmin "-${mins}" -print -quit 2>/dev/null)
  [ -n "$hit" ]
}

# Save uncommitted work before a forced removal: status, a binary patch of every
# tracked change (staged and unstaged), and a tarball of untracked files. Ignored
# files (node_modules, .next, env links) are regenerable and not kept.
archive_changes() {
  local wt="$1" br="$2" dest
  dest="$ARCHIVE_DIR/$(date '+%Y%m%d-%H%M%S')-$(basename "$wt")"
  mkdir -p "$dest" || return 1
  printf 'worktree %s\nbranch %s\nhead %s\n' "$wt" "$br" "$(git -C "$wt" rev-parse HEAD)" > "$dest/INFO" || return 1
  git -C "$wt" status --porcelain > "$dest/status.txt" || return 1
  git -C "$wt" diff HEAD --binary > "$dest/changes.patch" || return 1
  git -C "$wt" ls-files --others --exclude-standard -z \
    | tar -czf "$dest/untracked.tar.gz" -C "$wt" --null -T - || return 1
  printf '%s' "$dest"
}

REMOVED=0
ARCHIVED=0
SKIPPED=0

while IFS=$'\t' read -r wt br state pr_sha; do
  [ -n "$wt" ] || continue
  # Never touch the primary checkout.
  [ "$wt" = "$REPO" ] && continue
  [ -d "$wt" ] || continue

  # --- rail: PR must exist and be merged/closed -----------------------------
  case "$state" in
    MERGED|CLOSED) ;;
    *) SKIPPED=$((SKIPPED + 1)); continue ;;   # OPEN / NO_PR / unknown -> leave alone
  esac

  # --- rail: no local commits beyond what the PR contained ------------------
  # HEAD behind the PR head is fine: the extra commits were pushed from elsewhere.
  head_sha=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
  if [ "$head_sha" != "$pr_sha" ] && \
     ! git merge-base --is-ancestor "$head_sha" "$pr_sha" 2>/dev/null; then
    log "  KEEP (local commits past PR head): $wt [$br]"
    SKIPPED=$((SKIPPED + 1)); continue
  fi

  # --- rail: nothing running inside it, nothing touched recently ------------
  if is_busy "$wt"; then
    log "  KEEP (process live inside): $wt [$br]"
    SKIPPED=$((SKIPPED + 1)); continue
  fi
  if recently_active "$wt"; then
    log "  KEEP (modified in last ${ACTIVE_MINUTES}m): $wt [$br]"
    SKIPPED=$((SKIPPED + 1)); continue
  fi

  force=""
  if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      log "  DRY-RUN would archive uncommitted changes: $wt [$br]"
    elif dest=$(archive_changes "$wt" "$br"); then
      log "  archived uncommitted changes to $dest"
      ARCHIVED=$((ARCHIVED + 1))
    else
      log "  KEEP (archive of uncommitted changes failed): $wt [$br]"
      SKIPPED=$((SKIPPED + 1)); continue
    fi
    force="--force"
  fi

  sz=$(du -sh "$wt" 2>/dev/null | cut -f1)
  log "  removing worktree ($sz, PR $state): $wt [$br]"
  if [ "$DRY_RUN" = "1" ]; then
    log "  DRY-RUN would: git worktree remove $force $wt; git branch -D $br"
  else
    # --force only after a successful archive; a clean tree still goes without it,
    # so git's own modification check stays a second guard there.
    if git worktree remove $force "$wt" >/dev/null 2>&1; then
      REMOVED=$((REMOVED + 1))
      git branch -D "$br" >/dev/null 2>&1 || log "  note: kept local branch $br"
    else
      log "  WARN: git refused to remove $wt — left in place"
    fi
  fi
done < "$PR_STATE"

rm -f "$WT_LIST" "$PR_STATE"

# ---------------------------------------------------------------------------
# Pass 3c — worktrees whose HEAD already shipped but pass 3 cannot see
# ---------------------------------------------------------------------------
# Pass 3 matches a PR by branch name only. It misses detached HEADs, stacked
# sub-branches whose commits shipped inside a parent PR, and worktrees left on a
# main commit: 54 of 68 worktrees on 2026-10-04. Here GitHub is asked which PRs
# contain the HEAD commit.
#   - any OPEN PR on the branch or containing HEAD          -> kept
#   - HEAD on origin/main (nothing local to lose)           -> removed after MAIN_IDLE_HOURS idle
#   - HEAD inside a MERGED/CLOSED PR, not on main           -> removed after ACTIVE_MINUTES idle
#   - anything else (unpushed commits, no PR)               -> kept
# The branch is never deleted, a detached HEAD is saved as refs/archive/worktrees/<name>,
# and uncommitted changes are archived first.
git fetch --quiet origin main >/dev/null 2>&1 || log "  WARN: fetch of origin/main failed — using the local copy"

HEAD_LIST=$(mktemp)
git worktree list --porcelain | awk '
  /^worktree /{wt=substr($0, 10); br=""; head=""}
  /^HEAD /{head=$2}
  /^branch /{br=$2; sub("refs/heads/", "", br)}
  /^$/{if (wt != "") print wt"\t"br"\t"head; wt=""}
  END{if (wt != "") print wt"\t"br"\t"head}' \
  | awk -F'\t' -v repo="$REPO" '$1 != repo' > "$HEAD_LIST"

HEAD_STATE=$(mktemp)
if ! python3 - "$HEAD_LIST" "$GH_REPO" > "$HEAD_STATE" 2>/dev/null <<'PY'
import json, subprocess, sys
rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1]) if l.count("\t") == 2]
owner, name = sys.argv[2].split("/")
for i in range(0, len(rows), 30):
    chunk = rows[i:i + 30]
    parts = []
    for j, (_, br, head) in enumerate(chunk):
        if br:
            parts.append(f'b{j}: pullRequests(headRefName: {json.dumps(br)}, states: OPEN, first: 1) {{ nodes {{ number }} }}')
        parts.append(f'c{j}: object(oid: {json.dumps(head)}) {{ ... on Commit {{ '
                     f'associatedPullRequests(first: 10) {{ nodes {{ number state }} }} }} }}')
    q = f'query {{ repository(owner: "{owner}", name: "{name}") {{ {" ".join(parts)} }} }}'
    out = subprocess.run(["gh", "api", "graphql", "-f", f"query={q}"],
                         capture_output=True, text=True, check=True).stdout
    repo = json.loads(out)["data"]["repository"]
    for j, (wt, br, head) in enumerate(chunk):
        open_branch = bool(br) and bool(repo[f"b{j}"]["nodes"])
        prs = ((repo.get(f"c{j}") or {}).get("associatedPullRequests") or {}).get("nodes", [])
        if open_branch or any(p["state"] == "OPEN" for p in prs):
            state = "OPEN"
        elif prs:
            state = "SHIPPED:" + ",".join(f'#{p["number"]}' for p in prs)
        else:
            state = "NONE"
        # "-" for a detached HEAD: `read` collapses adjacent tabs, so an empty field would shift.
        print(f"{wt}\t{br or '-'}\t{head}\t{state}")
PY
then
  log "  WARN: HEAD-commit PR lookup failed — skipping pass 3c"
  : > "$HEAD_STATE"
fi

while IFS=$'\t' read -r wt br head state; do
  [ -n "$wt" ] && [ -d "$wt" ] || continue
  [ "$br" = "-" ] && br=""
  [ "$state" = "OPEN" ] && continue

  if git merge-base --is-ancestor "$head" origin/main 2>/dev/null; then
    why="HEAD on main"; idle_min=$((MAIN_IDLE_HOURS * 60))
  elif [ "${state%%:*}" = "SHIPPED" ]; then
    why="HEAD in ${state#SHIPPED:}"; idle_min="$ACTIVE_MINUTES"
  else
    continue
  fi

  if is_busy "$wt"; then
    log "  KEEP (process live inside): $wt [${br:-detached}]"
    SKIPPED=$((SKIPPED + 1)); continue
  fi
  # Quiet skip: an on-main worktree under 24h idle is normal, not news, every 15 min.
  recently_active "$wt" "$idle_min" && { SKIPPED=$((SKIPPED + 1)); continue; }

  if [ -z "$br" ]; then
    ref="refs/archive/worktrees/$(basename "$wt")"
    if [ "$DRY_RUN" = "1" ]; then
      log "  DRY-RUN would save detached HEAD as $ref"
    elif ! git update-ref "$ref" "$head"; then
      log "  KEEP (could not save detached HEAD): $wt"
      SKIPPED=$((SKIPPED + 1)); continue
    fi
  fi

  force=""
  if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      log "  DRY-RUN would archive uncommitted changes: $wt"
    elif dest=$(archive_changes "$wt" "${br:-detached}"); then
      log "  archived uncommitted changes to $dest"
      ARCHIVED=$((ARCHIVED + 1))
    else
      log "  KEEP (archive of uncommitted changes failed): $wt"
      SKIPPED=$((SKIPPED + 1)); continue
    fi
    force="--force"
  fi

  sz=$(du -sh "$wt" 2>/dev/null | cut -f1)
  kept="branch kept"; [ -z "$br" ] && kept="HEAD saved"
  log "  removing worktree ($sz, $why, $kept): $wt [${br:-detached}]"
  if [ "$DRY_RUN" = "1" ]; then
    log "  DRY-RUN would: git worktree remove $force $wt"
  elif git worktree remove $force "$wt" >/dev/null 2>&1; then
    REMOVED=$((REMOVED + 1))
  else
    log "  WARN: git refused to remove $wt — left in place"
  fi
done < "$HEAD_STATE"

rm -f "$HEAD_LIST" "$HEAD_STATE"

# ---------------------------------------------------------------------------
# Pass 3b — retire idle worktrees of any PR state (MODE=idle only)
# ---------------------------------------------------------------------------
# A worktree is only a checkout; the work lives in its branch. So a worktree left
# untouched for RETIRE_DAYS is removed while everything recoverable is kept: the
# branch stays, uncommitted changes are archived, and a detached HEAD gets a ref
# under refs/archive/worktrees/. `git worktree add <path> <branch>` brings it back.
RETIRED=0
if [ "$MODE" = "idle" ]; then
  cutoff=$(( $(date +%s) - RETIRE_DAYS * 86400 ))
  while IFS= read -r wt; do
    [ -n "$wt" ] || continue
    [ "$wt" = "$REPO" ] && continue
    [ -d "$wt" ] || continue
    is_busy "$wt" && { log "  KEEP (process live inside): $wt"; continue; }

    # Reflog entry time, not file mtime: git maintenance rewrites the reflog files.
    gd=$(git -C "$wt" rev-parse --absolute-git-dir 2>/dev/null) || continue
    last=$(tail -1 "$gd/logs/HEAD" 2>/dev/null | awk -F'\t' '{n=split($1,a," "); print a[n-1]}')
    [ -n "$last" ] && [ "$last" -gt "$cutoff" ] && continue
    [ -n "$(find "$wt" \( -name node_modules -o -name .next -o -name .git \) -prune -o \
            -type f -newermt "-${RETIRE_DAYS} days" -print -quit 2>/dev/null)" ] && continue

    br=$(git -C "$wt" symbolic-ref --quiet --short HEAD 2>/dev/null)
    if [ -z "$br" ]; then
      ref="refs/archive/worktrees/$(basename "$wt")"
      if [ "$DRY_RUN" = "1" ]; then
        log "  DRY-RUN would save detached HEAD as $ref"
      elif ! git update-ref "$ref" "$(git -C "$wt" rev-parse HEAD)"; then
        log "  KEEP (could not save detached HEAD): $wt"; continue
      fi
    fi

    force=""
    if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
      if [ "$DRY_RUN" = "1" ]; then
        log "  DRY-RUN would archive uncommitted changes: $wt"
      elif dest=$(archive_changes "$wt" "${br:-detached}"); then
        log "  archived uncommitted changes to $dest"
        ARCHIVED=$((ARCHIVED + 1))
      else
        log "  KEEP (archive of uncommitted changes failed): $wt"; continue
      fi
      force="--force"
    fi

    sz=$(du -sh "$wt" 2>/dev/null | cut -f1)
    log "  retiring idle worktree ($sz, ${RETIRE_DAYS}d+, branch kept): $wt [${br:-detached}]"
    if [ "$DRY_RUN" = "1" ]; then
      log "  DRY-RUN would: git worktree remove $force $wt"
    elif git worktree remove $force "$wt" >/dev/null 2>&1; then
      RETIRED=$((RETIRED + 1))
    else
      log "  WARN: git refused to remove $wt — left in place"
    fi
  done <<< "$(git worktree list --porcelain | awk '/^worktree /{print substr($0, 10)}')"
fi

# ---------------------------------------------------------------------------
# Pass 4 — stale npx package installs (full mode only)
# ---------------------------------------------------------------------------
# Each `npx <pkg>` leaves a full install in ~/.npm/_npx that is never reused once
# the version moves on (1.6GB on 2026-09-29). The shared ~/.npm/_cacache is kept:
# it is what makes a new worktree's `npm install` fast.
NPX_CLEARED=0
if [ "$MODE" = "full" ] && [ -d "$HOME/.npm/_npx" ]; then
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    run rm -rf "$d"
    NPX_CLEARED=$((NPX_CLEARED + 1))
  done <<< "$(find "$HOME/.npm/_npx" -mindepth 1 -maxdepth 1 -type d -mtime "+${NPX_AGE_DAYS}" 2>/dev/null)"
  [ "$NPX_CLEARED" -gt 0 ] && log "  cleared $NPX_CLEARED npx installs older than ${NPX_AGE_DAYS}d"
fi

END_FREE=$(free_gb)
log "=== janitor done: .next cleared $NEXT_CLEARED, dehydrated $DEHYDRATED, worktrees removed $REMOVED, retired $RETIRED (archived $ARCHIVED), kept $SKIPPED, npx cleared $NPX_CLEARED, caches cleared $CACHES_CLEARED ==="
log "=== free ${START_FREE}GB -> ${END_FREE}GB ==="

# Shout if we're still tight after cleaning — that means something new is eating disk.
if [ "$END_FREE" -lt "$LOW_DISK_GB" ] && [ "$DRY_RUN" != "1" ]; then
  log "!!! LOW DISK: only ${END_FREE}GB free after cleanup"
  osascript -e "display notification \"Only ${END_FREE}GB free after worktree cleanup.\" with title \"Disk running low\"" 2>/dev/null
fi
