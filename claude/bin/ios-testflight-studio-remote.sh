#!/bin/bash
# The Mac Studio half of ios-testflight-studio: builds a commit of sideshift-mobile and puts it in
# TestFlight for the internal testers, with the same scripts as the GitHub workflow
# (.github/workflows/ios-testflight.yml, scripts/ios-release/ on the tooling commit).
#
#   bash run.sh start-stdin    arguments on stdin, each ended by NUL:
#                              <run-id> <branch> <source-sha> <tooling-sha> <what-to-test> <upload 1|0>
#       Detaches, then writes ~/testflight/runs/<run-id>/{pid,log} and, when done, status (the exit code).
#       Arguments come on stdin so the login shell (zsh) never parses them.
#
# The commits come from the heavy-remote mirror (the MacBook pushes refs/testflight/runs/<id>/*).
# Secrets live only in ~/testflight/secrets (mode 700): AuthKey.p8, api-key-id, issuer-id,
# distribution.p12, distribution.p12.password, team-id; each step gets only the ones it needs.
# The compile holds one of the xcode slots that heavy-remote jobs share, for at most an hour; one
# TestFlight run at a time (they share the checkout and DerivedData). Builds stay whole-module, as
# the App Store build is: TestFlight is where the app's speed is judged.
set -uo pipefail
umask 077
R="$HOME/heavy-remote.noindex"
T="$HOME/testflight"
S="$T/secrets"
MIRROR="$R/mirrors/sideshift-mobile.git"
SELF="$T/bin/run.sh"
ARCHIVE_MAX_SECONDS="${TESTFLIGHT_ARCHIVE_MAX_SECONDS:-3600}"

die() { echo "testflight: $*" >&2; exit 1; }

# Run "$@" in its own process group and stop the whole group after $1 seconds: a hung xcodebuild
# or altool must not hold a shared slot for hours.
with_time_limit() {
  local secs="$1"; shift
  ( set -m
    "$@" & job=$!
    ( sleep "$secs"; echo "testflight: stopped after $((secs / 60)) min" >&2
      kill -TERM -- "-$job" 2>/dev/null; sleep 20; kill -KILL -- "-$job" 2>/dev/null ) & dog=$!
    wait "$job"; rc=$?
    kill -- "-$dog" 2>/dev/null; wait "$dog" 2>/dev/null
    exit "$rc" )
}

# Run "$@" holding a free xcode slot; wait while both are busy. lockf exits 75 when a slot is
# taken, and the marker tells that apart from "$@" itself exiting 75.
with_xcode_slot() {
  local i rc mark="$RUNNER_TEMP/slot-taken"
  while :; do
    for i in 1 2; do
      rm -f "$mark"
      lockf -s -t 0 "$R/slots/xcode.$i" /bin/bash -c 'touch "$0"; exec "$@"' "$mark" "$@"
      rc=$?
      [ "$rc" -eq 75 ] && [ ! -e "$mark" ] && continue
      return "$rc"
    done
    echo "testflight: both xcode slots are busy; waiting" >&2
    sleep 20
  done
}

with_api_key() {
  ( export APPSTORE_API_PRIVATE_KEY; APPSTORE_API_PRIVATE_KEY=$(cat "$S/AuthKey.p8"); "$@" )
}

with_signing_identity() {
  ( export APPLE_DISTRIBUTION_CERTIFICATE_BASE64 APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD
    APPLE_DISTRIBUTION_CERTIFICATE_BASE64=$(base64 <"$S/distribution.p12" | tr -d '\n')
    APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD=$(cat "$S/distribution.p12.password")
    "$@" )
}

checkout() {  # <dir> <ref>
  [ -d "$1/.git" ] || git clone -q --no-checkout "$MIRROR" "$1" 2>/dev/null
  git -C "$1" fetch -q origin "$2" && git -C "$1" checkout -q --detach -f FETCH_HEAD && git -C "$1" clean -qffdx
}

# Keep the newest 10 finished runs. A run without a status file may still be building.
prune() {
  local d id n=0
  for d in $(ls -1dt "$T"/runs/*/ 2>/dev/null); do
    [ -s "$d/status" ] || continue
    n=$((n + 1)); [ "$n" -le 10 ] && continue
    id=$(basename "$d")
    rm -rf "$d"
    git --git-dir="$MIRROR" update-ref -d "refs/testflight/runs/$id/source" 2>/dev/null
    git --git-dir="$MIRROR" update-ref -d "refs/testflight/runs/$id/tooling" 2>/dev/null
  done
}

work() {
  local id="$1" branch="$2" sha="$3" tooling_sha="$4" what="$5" upload="$6"
  local run="$T/runs/$id" start=$SECONDS
  for f in AuthKey.p8 api-key-id issuer-id distribution.p12 distribution.p12.password team-id; do
    [ -s "$S/$f" ] || die "missing $S/$f"
  done
  checkout "$T/source" "refs/testflight/runs/$id/source" || die "could not check out the source commit"
  checkout "$T/tooling" "refs/testflight/runs/$id/tooling" || die "could not check out the tooling commit"
  [ "$(git -C "$T/source" rev-parse HEAD)" = "$sha" ] || die "source checkout is not $sha"
  [ "$(git -C "$T/tooling" rev-parse HEAD)" = "$tooling_sha" ] || die "tooling checkout is not $tooling_sha"
  local tools="$T/tooling/scripts/ios-release"

  export RELEASE_DIR="$run/out" RUNNER_TEMP="$run/tmp" GITHUB_OUTPUT="$run/plan.env"
  export IOS_RELEASE_DERIVED_DATA="$T/dd" BRANCH_NAME="$branch" SOURCE_SHA="$sha" WHAT_TO_TEST="$what"
  # The Studio's Xcode (26.6) refuses the GitHub runner's ad-hoc archive signature.
  export IOS_RELEASE_ARCHIVE_SIGNING=distribution
  export APPSTORE_API_KEY_ID APPSTORE_ISSUER_ID APPLE_TEAM_ID
  APPSTORE_API_KEY_ID=$(cat "$S/api-key-id"); APPSTORE_ISSUER_ID=$(cat "$S/issuer-id"); APPLE_TEAM_ID=$(cat "$S/team-id")
  mkdir -p "$RELEASE_DIR" "$RUNNER_TEMP"
  : >"$GITHUB_OUTPUT"
  trap 'rm -f "$RELEASE_DIR/AuthKey.p8" "$RELEASE_DIR/certificate.p12" "$RELEASE_DIR"/*.mobileprovision' EXIT

  echo "== $(date '+%H:%M:%S') building $sha ($branch) on the Mac Studio"
  [ -n "$what" ] && echo "What to Test: $what"
  python3 -m unittest discover -s "$tools" -p 'test_*.py' >"$run/tests.log" 2>&1 \
    || { tail -20 "$run/tests.log"; die "release script tests failed"; }
  echo "release script tests: $(grep -E '^(Ran |OK)' "$run/tests.log" | tr '\n' ' ')"
  with_signing_identity bash "$tools/archive.sh" --check-signing || die "signing identity check failed"
  with_api_key python3 "$tools/prepare.py" --source "$T/source" || die "prepare.py failed"
  local version build
  version=$(sed -n 's/^version=//p' "$GITHUB_OUTPUT"); build=$(sed -n 's/^build=//p' "$GITHUB_OUTPUT")
  echo "== $(date '+%H:%M:%S') archive, export$([ "$upload" = 1 ] && echo ', upload') $version ($build)"
  UPLOAD_TO_TESTFLIGHT="$upload" with_signing_identity with_time_limit "$ARCHIVE_MAX_SECONDS" \
    with_xcode_slot bash "$tools/archive.sh" "$T/source" "$version" "$build" \
    || die "archive or upload failed"
  if [ "$upload" != 1 ]; then
    rm -rf "$RELEASE_DIR/SideShift.xcarchive" "$RELEASE_DIR/export"
    echo "== $(date '+%H:%M:%S') archived and validated after $(( (SECONDS - start) / 60 )) min; not uploaded"
    return 0
  fi
  echo "== $(date '+%H:%M:%S') uploaded after $(( (SECONDS - start) / 60 )) min; waiting for Apple's processing"
  with_api_key python3 -u "$tools/finalize.py" --source "$T/source" --timeout-minutes 40 || die "finalize.py failed"
  # Apple has the build and its symbols; a failed run keeps these for a look.
  rm -rf "$RELEASE_DIR/SideShift.xcarchive" "$RELEASE_DIR/export"
  echo "== $(date '+%H:%M:%S') in TestFlight after $(( (SECONDS - start) / 60 )) min"
}

case "${1:-}" in
  start-stdin)
    args=()
    while IFS= read -r -d '' a; do args+=("$a"); done
    [ "${#args[@]}" -eq 6 ] || die "start-stdin needs 6 NUL-ended arguments, got ${#args[@]}"
    [[ "${args[0]}" =~ ^[0-9A-Za-z-]+$ ]] || die "bad run id"
    run="$T/runs/${args[0]}"
    mkdir -p "$run"
    # Detached, so a dropped ssh connection or a sleeping MacBook does not stop an upload.
    nohup /bin/bash -c 'run=$1; shift; lockf "$run/../../run.lock" "$0" work "$@"; echo $? > "$run/status"' \
      "$SELF" "$run" "${args[@]}" >"$run/log" 2>&1 </dev/null &
    echo $! >"$run/pid"
    prune
    echo "$run"
    ;;
  work) shift; work "$@" ;;
  *) die "usage: bash $0 start-stdin, with the arguments on stdin" ;;
esac
