#!/bin/bash
#
# heavy-remote-helper.sh — the Mac Studio side of heavy-remote.mjs. The MacBook
# copies this file to ~/heavy-remote/bin/helper-<hash>.sh on the Studio and runs
# it over SSH. Nothing here runs on the MacBook.
#
# Layout under ~/heavy-remote (R):
#   node24/             official Node 24 build (the monorepo's version); the
#                       Studio's own Homebrew node stays untouched
#   mirror.git          bare repo the MacBook pushes monorepo job commits into
#   mirrors/<repo>.git  the same for other repos (sideshift-mobile)
#   dd/<key>/           Xcode DerivedData per MacBook worktree (iOS jobs), kept here
#   work/<key>/         one worktree per MacBook worktree, reused between jobs
#   state/<key>/        markers for that worktree (deps key, packages hash, pgid)
#   installs/<depkey>/  cached node_modules per package-lock.json, APFS-cloned
#   out/<job>/          files the job wrote to /tmp or ~/.claude/jobs paths
#   slots/              lockf slot files
#
# Commands:
#   probe <depkey> [pool]   print "slots=N disk_gb=N mem=N install=yes|no|building env=…"
#   run <key> <sha> <depkey> <job> <maxsecs> <script>
#                           env: HEAVY_REMOTE_POOL (slot|xcode), HEAVY_REMOTE_MIRROR,
#                           HEAVY_REMOTE_SUBDIR, HEAVY_REMOTE_SIMS (iOS simulators to map)
#                           stdin: tar of dirty files (wd/...) and inputs (out/...)
#                           stdin also carries deleted paths in wd.deleted
#   collect <job>           stdout: tar of the job's output files; then removes them
#   kill <key>              stop the job running in <key>
set -uo pipefail

R="$HOME/heavy-remote"
NODE_BIN="$R/node24/bin"
POOL="${HEAVY_REMOTE_POOL:-slot}"
MIRROR="$R/${HEAVY_REMOTE_MIRROR:-mirror.git}"
if [ "$POOL" = xcode ]; then
	SLOTS="${HEAVY_REMOTE_XCODE_SLOTS:-2}"
	# An iOS build's DerivedData is about 9 GB.
	MIN_DISK_GB="${HEAVY_REMOTE_XCODE_MIN_DISK_GB:-30}"
else
	SLOTS="${HEAVY_REMOTE_SLOTS:-2}"
	MIN_DISK_GB="${HEAVY_REMOTE_MIN_DISK_GB:-10}"
fi
MIN_MEM="${HEAVY_REMOTE_MIN_MEM_PCT:-15}"
START_MARK=$'\x01HEAVY-REMOTE-START'

mem_free_pct() {
	vm_stat 2>/dev/null | awk -v total="$(sysctl -n hw.memsize 2>/dev/null)" '
		/page size of/ { for (i = 1; i < NF; i++) if ($i == "of") ps = $(i + 1) }
		/^Pages wired down/ { w = $NF }
		/^Anonymous pages/ { a = $NF }
		/^Pages occupied by compressor/ { c = $NF }
		END {
			if (!ps || !total || !a) exit 1
			f = 100 - (w + a + c) * ps * 100 / total
			printf "%d", (f < 0 ? 0 : f)
		}'
}
disk_free_gb() { df -g "$R" | awk 'NR == 2 { print $4 }'; }
free_slots() {
	local n=0 i
	for ((i = 1; i <= SLOTS; i++)); do
		lockf -s -t 0 "$R/slots/$POOL.$i" true 2>/dev/null && n=$((n + 1))
	done
	echo "$n"
}
install_state() {
	if [ "$1" = none ] || [ -f "$R/installs/$1/manifest" ]; then echo yes
	elif ! lockf -s -t 0 "$R/installs/$1.lock" true 2>/dev/null; then echo building
	else echo no; fi
}

# Build installs/<depkey> from a copy of a synced worktree, in the background.
build_install() {
	local depkey="$1" src="$2" tmp="$R/installs/$1.tmp"
	rm -rf "$tmp"
	mkdir -p "$tmp" || return 1
	# APFS clone of the source tree minus node_modules: costs no disk until written.
	(cd "$src" && find . -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .git -exec cp -cR {} "$tmp/" \;) || return 1
	find "$tmp" -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null
	(cd "$tmp" && PATH="$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" npm ci --no-audit --no-fund) >"$R/installs/$depkey.log" 2>&1 || return 1
	local dirs
	dirs=$(cd "$tmp" && find . -name node_modules -type d -prune -not -path '*/node_modules/*' | sed 's|^\./||')
	mkdir -p "$R/installs/$depkey" || return 1
	local d
	for d in $dirs; do
		mkdir -p "$R/installs/$depkey/$(dirname "$d")"
		mv "$tmp/$d" "$R/installs/$depkey/$d"
	done
	printf '%s\n' $dirs >"$R/installs/$depkey/manifest"
	rm -rf "$tmp"
	# Keep the three newest installs.
	ls -1t "$R/installs" | grep -v '\.' | tail -n +4 | while read -r old; do
		lockf -s -t 0 "$R/installs/$old.lock" rm -rf "$R/installs/$old"
	done
}

cmd="${1:-}"
shift || true
mkdir -p "$R/slots" "$R/state" "$R/work" "$R/installs" "$R/out" "$R/dd" "$R/mirrors"

case "$cmd" in
probe)
	[ -n "${2:-}" ] && POOL="$2" && [ "$POOL" = xcode ] && SLOTS="${HEAVY_REMOTE_XCODE_SLOTS:-2}"
	envsum=$(shasum -a 256 "$R/secrets/env.local" 2>/dev/null | cut -c1-12)
	echo "slots=$(free_slots) disk_gb=$(disk_free_gb) mem=$(mem_free_pct) install=$(install_state "$1") env=${envsum:-none}"
	;;

run)
	key="$1" sha="$2" depkey="$3" job="$4" maxsecs="$5" script="$6"
	# Take a slot, then this worktree's lock. Busy: exit 75 without the start mark.
	for ((i = 1; i <= SLOTS; i++)); do
		lockf -s -t 0 "$R/slots/$POOL.$i" lockf -s -t 0 "$R/state/$key.lock" \
			"$0" run-locked "$key" "$sha" "$depkey" "$job" "$maxsecs" "$script" "$i"
		rc=$?
		# 75 from lockf: that slot or this worktree is busy, nothing read from stdin yet.
		[ "$rc" -eq 75 ] && [ ! -e "$R/out/$job/.started" ] && continue
		exit "$rc"
	done
	echo "heavy-remote: no free slot" >&2
	exit 75
	;;

run-locked)
	key="$1" sha="$2" depkey="$3" job="$4" maxsecs="$5" script="$6" slot="$7"
	wd="$R/work/$key" st="$R/state/$key" out="$R/out/$job"
	mkdir -p "$st" "$out"
	# 76: set-up failed after stdin was read; the MacBook runs the job itself.
	fail() { echo "heavy-remote: $*" >&2; rm -rf "$out"; exit 76; }
	# Set-up output goes to stderr, which the MacBook hides; the job gets stdout back.
	exec 3>&1 1>&2
	[ "$(disk_free_gb)" -ge "$MIN_DISK_GB" ] || fail "disk below ${MIN_DISK_GB} GB"
	mem=$(mem_free_pct) && [ "$mem" -lt "$MIN_MEM" ] && fail "memory ${mem}% free"
	t0=$SECONDS
	# Code: the pushed commit, then the MacBook's uncommitted files on top.
	if [ ! -e "$wd/.git" ]; then
		rm -rf "$wd"
		git -C "$MIRROR" worktree add -q --detach "$wd" "$sha" >&2 || fail "worktree add failed"
	else
		git -C "$wd" checkout -q -f --detach "$sha" >&2 || fail "checkout failed"
		git -C "$wd" clean -q -f -d >&2
	fi
	t_checkout=$((SECONDS - t0))
	tar -xf - -C "$out" || fail "could not unpack the files"
	if [ -d "$out/wd" ]; then
		(cd "$out/wd" && find . -mindepth 1 -maxdepth 1 -exec cp -cR {} "$wd/" \;) || fail "could not copy the files"
		rm -rf "$out/wd"
	fi
	if [ -f "$out/wd.deleted" ]; then
		(cd "$wd" && tr '\n' '\0' <"$out/wd.deleted" | xargs -0 rm -f --)
		rm -f "$out/wd.deleted"
	fi
	# The MacBook's .env.local (owner-only copy), so tests load what they load there.
	if [ "$depkey" != none ] && [ -f "$R/secrets/env.local" ]; then ln -sfn "$R/secrets/env.local" "$wd/.env.local"; else rm -f "$wd/.env.local"; fi
	t_sync=$((SECONDS - t0 - t_checkout))
	export PATH="$NODE_BIN:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
	# Dependencies: clone the cached install for this lockfile (none for the mobile repo).
	if [ "$depkey" != none ] && [ "$(cat "$st/deps" 2>/dev/null)" != "$depkey" ]; then
		case "$(install_state "$depkey")" in
		yes) ;;
		building) fail "dependencies are still installing" ;;
		*)
			(lockf -s -t 0 "$R/installs/$depkey.lock" "$0" build-install "$depkey" "$wd" </dev/null >/dev/null 2>&1 &)
			fail "dependencies are not installed yet; installing in the background"
			;;
		esac
		(cd "$wd" && find . -name node_modules -type d -prune -not -path '*/node_modules/*' -exec rm -rf {} +)
		while read -r d; do
			[ -n "$d" ] && [ -d "$wd/$(dirname "$d")" ] && cp -cR "$R/installs/$depkey/$d" "$wd/$d"
		done <"$R/installs/$depkey/manifest"
		(cd "$wd" && npm run -s postinstall) >"$st/postinstall.log" 2>&1 || fail "postinstall failed (see $st/postinstall.log)"
		echo "$depkey" >"$st/deps"
		rm -f "$st/packages"
	fi
	# Workspace packages: rebuild when their sources changed since the last build.
	pk=$( (cd "$wd" && git ls-files -s packages; git -C "$wd" status --porcelain -- packages | while read -r _ f; do [ -f "$wd/$f" ] && shasum "$wd/$f"; done) | shasum | cut -c1-40)
	if [ "$depkey" != none ] && [ "$(cat "$st/packages" 2>/dev/null)" != "$pk" ]; then
		(cd "$wd" && npm run -s build:packages) >"$st/build.log" 2>&1 || fail "build:packages failed (see $st/build.log)"
		echo "$pk" >"$st/packages"
	fi
	# iOS: the MacBook's simulator becomes one of this slot's own simulators with the
	# same device type and runtime, so two jobs never share a simulator.
	if [ -n "${HEAVY_REMOTE_SIMS:-}" ]; then
		IFS=';' read -ra sims <<<"$HEAVY_REMOTE_SIMS"
		for spec in "${sims[@]}"; do
			IFS='|' read -r udid name dtype runtime <<<"$spec"
			target="heavy $slot $name"
			new=$(xcrun simctl list devices -j | "$NODE_BIN/node" -e '
				const [rt, nm] = process.argv.slice(1); let s = ""; process.stdin.on("data", (d) => (s += d));
				process.stdin.on("end", () => { const d = (JSON.parse(s).devices[rt] || []).find((x) => x.name === nm && x.isAvailable); if (d) console.log(d.udid); });
			' "$runtime" "$target")
			[ -n "$new" ] || new=$(xcrun simctl create "$target" "$dtype" "$runtime" 2>&1) || fail "could not create simulator $target: $new"
			script="${script//$udid/$new}"
			simmap="${simmap:+$simmap;}$new=$udid"
		done
		# The MacBook maps these back in the job's output.
		echo "heavy-remote: sims $simmap" >&2
	fi
	# The SSH session that carries this job. Each run uses its own connection (no
	# multiplexing), so the session ends when the MacBook side dies, even by SIGKILL.
	sshpid=$$
	while :; do
		up=$(ps -o ppid= -p "$sshpid" | tr -d ' ')
		[ -n "$up" ] && [ "$up" -gt 1 ] || { sshpid=""; break; }
		sshpid=$up
		case "$(ps -o comm= -p "$sshpid")" in *sshd*) break ;; esac
	done
	[ -n "$sshpid" ] || fail "could not find the SSH session"
	kill -0 "$sshpid" 2>/dev/null || fail "the MacBook disconnected"
	# Untracked files before the job, to report the ones it deletes.
	(cd "$wd" && git ls-files -o --exclude-standard -z) >"$st/untracked.before"
	echo "heavy-remote: timing checkout=${t_checkout}s sync=${t_sync}s total=$((SECONDS - t0))s" >&2
	touch "$out/.started"
	stamp="$st/start-stamp"
	touch "$stamp"
	sleep 1 # mtime granularity: a file the job writes is newer than the stamp
	printf '%s\n' "$START_MARK" >&2
	exec 1>&3 3>&-
	cd "$wd/${HEAVY_REMOTE_SUBDIR:-.}" || exit 1
	# The job in its own process group with a time limit, as in bin/heavy.
	set -m
	/bin/zsh -c "$script" </dev/null &
	job_pid=$!
	echo "$job_pid" >"$st/pgid"
	(
		sleep "$maxsecs"
		if kill -0 "$job_pid" 2>/dev/null; then
			echo "heavy: stopped after $((maxsecs / 60)) min holding a slot; the job ran too long or hung" >&3
			kill -TERM -- "-$job_pid" 2>/dev/null
			sleep 10
			kill -KILL -- "-$job_pid" 2>/dev/null
		fi
	) </dev/null >/dev/null 3>&2 2>/dev/null &
	dog=$!
	# Stop the job when the MacBook side goes away.
	(
		while kill -0 "$sshpid" 2>/dev/null && kill -0 "$job_pid" 2>/dev/null; do sleep 3; done
		kill -TERM -- "-$job_pid" 2>/dev/null
	) </dev/null >/dev/null 2>&1 &
	gone=$!
	set +m
	trap 'kill -TERM -- -$job_pid 2>/dev/null' TERM INT HUP
	wait "$job_pid"
	rc=$?
	while kill -0 "$job_pid" 2>/dev/null; do wait "$job_pid"; rc=$?; done
	kill -- "-$dog" "-$gone" 2>/dev/null
	rm -f "$st/pgid"
	# The job's own exit code: ssh reports 255 for a lost connection too.
	echo "$rc" >"$out/.rc"
	# What the job changed in the worktree (snapshots, --fix, coverage/, deletions):
	# copy it out before the lock is released, so a later job cannot change it first.
	# Dependency installs and caches are left out.
	cd "$wd" || exit "$rc"
	find . \( -name node_modules -o -name .git -o -name .next -o -name .turbo \) -prune -o -type f -newer "$stamp" -print0 2>/dev/null |
		while IFS= read -r -d '' f; do
			f=${f#./}
			mkdir -p "$out/wd-changed/$(dirname "$f")"
			cp -c "$f" "$out/wd-changed/$f"
		done
	{
		git ls-files -d -z
		while IFS= read -r -d '' f; do [ -e "$f" ] || printf '%s\0' "$f"; done <"$st/untracked.before"
	} >"$out/wd-deleted"
	exit "$rc"
	;;

build-install)
	build_install "$1" "$2"
	;;

collect)
	job="$1" out="$R/out/$1"
	[ -d "$out" ] || exit 0
	# Only files the job wrote: inputs the MacBook uploaded are older than .started.
	(cd "$out" && find . -type f -newer .started ! -name .started -print0 | tar -cf - --null -T -)
	rm -rf "$out"
	# Remove out dirs of jobs whose MacBook side died, and idle worktrees.
	find "$R/out" -mindepth 1 -maxdepth 1 -type d -mmin +1440 -exec rm -rf {} + 2>/dev/null
	# The Studio's disk is shared and nearly full: keep at most WORK_KEEP worktrees,
	# and none idle for a day. The state dir changes on every job (pgid file).
	n=0
	for k in $(ls -1t "$R/state" 2>/dev/null | grep -v '\.lock$'); do
		wdir="$R/work/$k"
		[ -d "$wdir" ] || continue
		n=$((n + 1))
		if { [ "$n" -gt "${WORK_KEEP:-6}" ] || [ -n "$(find "$R/state/$k" -maxdepth 0 -mtime +0 2>/dev/null)" ]; } &&
			lockf -s -t 0 "$R/state/$k.lock" true; then
			repo=$(git -C "$wdir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
			git -C "${repo:-$MIRROR}" worktree remove --force "$wdir" 2>/dev/null || rm -rf "$wdir"
			rm -rf "$R/state/$k" "$R/state/$k.lock" "$R/dd/$k" "$R/dd/$k-spm"
			[ -n "$repo" ] && git -C "$repo" update-ref -d "refs/heavy/$k" 2>/dev/null
		fi
	done
	for m in "$R/mirror.git" "$R"/mirrors/*.git; do [ -d "$m" ] && git -C "$m" worktree prune 2>/dev/null; done
	;;

init-mirror)
	# init-mirror <path under R> <repo>: a bare mirror filled from GitHub's main.
	m="$R/$1"
	[ -d "$m" ] && exit 0
	git init -q --bare "$m.tmp" &&
		git -C "$m.tmp" config credential.helper '!/opt/homebrew/bin/gh auth git-credential' &&
		git -C "$m.tmp" fetch -q "https://github.com/SideShiftApp/$2.git" '+refs/heads/main:refs/remotes/origin/main' &&
		mv "$m.tmp" "$m"
	;;

kill)
	pg=$(cat "$R/state/$1/pgid" 2>/dev/null) && [ -n "$pg" ] && kill -TERM -- "-$pg" 2>/dev/null
	exit 0
	;;

*)
	echo "heavy-remote-helper: unknown command '$cmd'" >&2
	exit 2
	;;
esac
