#!/usr/bin/env node
//
// agent-reaper.mjs — give back the memory that agent sessions leave behind.
// launchd runs it every 5 minutes (launchd/com.sideshift.agent-reaper.plist);
// the launch gate (hooks/launch-gate.mjs) uses its listings.
//
//   simulators   Shut down a booted simulator that nothing has used for
//                SIM_IDLE_MIN (20) minutes: no tool names it (xcodebuild,
//                simctl, log stream) and no app runs in it. An app left open
//                with no tool attached keeps it up for SIM_APP_HOURS (4) at
//                most. Test clones go once no xcodebuild has run for 5 minutes.
//                A shut-down simulator whose last user (~/.cache/agent-sims) is a
//                Claude session that has ended goes with that session, as its
//                Chrome window does: deleted, or emptied (`simctl erase`) when
//                tools ask for it by name. An Android emulator whose last user
//                ended is stopped, and its phone (AVD) wiped to factory data.
//   dev servers  Stop an agent's `next dev` that uses more than DEV_MAX_GB (12)
//                of memory, or that has had no client connected for
//                DEV_IDLE_HOURS (2). A server started from your own terminal is
//                never touched, and neither is a Next server outside a git
//                checkout (the shiftpool gateway every session talks through).
//   Chrome tabs  Close tabs in the shared agent Chrome whose page has not
//                loaded or changed URL for TAB_IDLE_HOURS (2).
//   orphans      Kill a Claude Code background-task shell whose session is
//                gone (its parent is launchd: `claude stop`, a recompact
//                handoff or a crash leaves it running), and a node-pty helper
//                whose app is gone, once seen orphaned for ORPHAN_MIN (30)
//                minutes. Nothing can read their output any more. One with a
//                dev server or a connected client inside is left alone.
//   containers   Stop (never remove) a container in the default Colima VM that
//                has had no real network traffic for CONTAINER_IDLE_HOURS (24).
//                The VM has a fixed 6 GB, and agents' leftover databases fill
//                it. `docker start <name>` brings one back with its data.
//                KEEP_CONTAINERS (comma list) and sideshift-pg-local are kept.
//   sessions     Keep a background Claude session running until it has been idle
//                for SESSION_AWAKE_HOURS (1). Claude Code stops one after an idle
//                hour (hard-coded) unless it is pinned, so the reaper pins each
//                running session and unpins it once idle that long. A pin set or
//                removed by hand (Ctrl+T in `claude agents`) is left alone.
//
// Idle time is observed, not guessed: each run records what it saw in
// ~/.cache/agent-reaper/state.json and counts idle time from the last run that
// saw the thing in use.
//
// Usage:  agent-reaper.mjs             act; actions go to ~/.claude/logs/agent-reaper.log
//         agent-reaper.mjs --dry-run   print every decision, stop nothing
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const env = (k, d) => Number(process.env[k] ?? d);
const SIM_IDLE_MS = env("SIM_IDLE_MIN", 20) * 60e3;
const SIM_APP_MS = env("SIM_APP_HOURS", 4) * 3600e3;
const SIM_CLONE_MS = 5 * 60e3;
const DEV_MAX_KB = env("DEV_MAX_GB", 12) * 1024 * 1024;
const DEV_IDLE_MS = env("DEV_IDLE_HOURS", 2) * 3600e3;
const TAB_IDLE_MS = env("TAB_IDLE_HOURS", 2) * 3600e3;
// An emulator's host memory grows while it runs: a 4 GB phone reached 35 GB in 24 h (2026-11-13).
const EMU_MAX_KB = env("EMU_MAX_GB", 12) * 1024 * 1024;
const EMU_IDLE_MS = env("EMU_IDLE_MIN", 10) * 60e3;
// One Kotlin compiler daemon serves every Gradle build and stays up while any build uses it
// at least every 2 h; it reached 7 GB after 18 h (2026-11-13).
const KOTLIN_MAX_KB = env("KOTLIN_MAX_GB", 5) * 1024 * 1024;
const ORPHAN_MS = env("ORPHAN_MIN", 30) * 60e3;
const CONTAINER_IDLE_MS = env("CONTAINER_IDLE_HOURS", 24) * 3600e3;
const CONTAINER_ACTIVE_BYTES = 16 * 1024;
const KEEP_CONTAINERS = new Set(["sideshift-pg-local", ...(process.env.KEEP_CONTAINERS ?? "").split(",").filter(Boolean)]);
// 1 h since 2026-11-11 (was 12): an idle session holds 0.4-1 GB, and memory limits how many agents run.
const AWAKE_MS = env("SESSION_AWAKE_HOURS", 1) * 3600e3;
const CLAUDE = join(HOME, ".local/bin/claude");
const JOBS = join(HOME, ".claude/jobs");
const PINS = join(JOBS, "pins.json");
const DOCKER_SOCK = join(HOME, ".colima/default/docker.sock");
const CHROME = `http://127.0.0.1:${process.env.AGENT_CHROME_PORT || 9222}`;
const STATE = join(HOME, ".cache/agent-reaper/state.json");
// session-board/scripts/sim-owner.mjs writes the id of the session that last used each simulator here.
const SIM_USERS = join(HOME, ".cache/agent-sims");
const SIM_OWNER_GRACE_MS = env("SIM_OWNER_GRACE_MIN", 60) * 60e3;
// Simulators that tools ask for by name: emptied, never deleted.
const SHARED_SIMS = new Set(["SideShift iPhone 17 Pro (PiP)"]);
const AVD_DIR = join(HOME, ".android/avd");
const ADB = "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";
// A phone's own data. The emulator rebuilds these from the system image on its next boot,
// as `-wipe-data` does (checked 2026-11-11: a wiped sideshift-api26 booted in 20 s).
const AVD_DATA = [
	"userdata-qemu.img",
	"userdata-qemu.img.qcow2",
	"cache.img",
	"cache.img.qcow2",
	"encryptionkey.img",
	"encryptionkey.img.qcow2",
	"snapshots",
	"data",
	"tmpAdbCmds",
	"bootcompleted.ini",
	"read-snapshot.txt",
	"multiinstance.lock",
];
const LOG = join(HOME, ".claude/logs/agent-reaper.log");
// The Command Line Tools xcrun has no simctl.
const XCODE_ENV = { ...process.env, DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" };

function run(file, args, opts = {}) {
	try {
		return execFileSync(file, args, { encoding: "utf8", maxBuffer: 64 << 20, timeout: 15000, stdio: ["ignore", "pipe", "ignore"], ...opts });
	} catch (err) {
		return err.stdout ?? ""; // lsof exits 1 when it finds nothing
	}
}

// [[dd-]hh:]mm:ss
function etimeSeconds(s) {
	const [days, rest] = s.includes("-") ? s.split("-") : ["0", s];
	const p = rest.split(":").map(Number);
	while (p.length < 3) p.unshift(0);
	return Number(days) * 86400 + p[0] * 3600 + p[1] * 60 + p[2];
}

export function processes() {
	const out = [];
	for (const line of run("/bin/ps", ["-axww", "-o", "pid=,ppid=,rss=,etime=,command="]).split("\n")) {
		const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
		if (m) out.push({ pid: +m[1], ppid: +m[2], rssKB: +m[3], ageSec: etimeSeconds(m[4]), cmd: m[5] });
	}
	return out;
}

const isAgent = (cmd) => /^(\S*\/)?(claude|codex)(\s|$)/.test(cmd) || /\/claude\/versions\/[^/\s]+(\s|$)/.test(cmd);
const isTerminal = (cmd) =>
	/\/(Ghostty|Terminal|iTerm2?|iTerm|Cursor|Visual Studio Code|WezTerm|Alacritty|kitty|Warp|Zed)\.app\/Contents\/MacOS\//.test(cmd) ||
	/^(\S*\/)?tmux(:|\s|$)/.test(cmd);

// "agent" (a Claude or Codex session started it), "terminal" (you did), or
// "orphan" (its starter is gone).
function owner(pid, byPid) {
	for (let p = byPid.get(byPid.get(pid)?.ppid), hops = 0; p && hops < 64; p = byPid.get(p.ppid), hops++) {
		if (isAgent(p.cmd)) return "agent";
		if (isTerminal(p.cmd)) return "terminal";
		if (p.ppid <= 1) break;
	}
	return "orphan";
}

function simctl(args) {
	return run("/usr/bin/xcrun", ["simctl", ...args], { env: XCODE_ENV, timeout: 30000 });
}

export function bootedSims(procs = processes()) {
	const sims = [];
	for (const set of ["default", "testing"]) {
		let json;
		try {
			json = JSON.parse(simctl([...(set === "testing" ? ["--set", "testing"] : []), "list", "-j", "devices", "booted"]));
		} catch {
			continue;
		}
		for (const devices of Object.values(json.devices ?? {}))
			for (const d of devices)
				if (d.state === "Booted") sims.push({ udid: d.udid, name: d.name, set, bootedAt: Date.parse(d.lastBootedAt) || null });
	}
	const xcodebuild = procs.find((p) => /^(\S*\/)?xcodebuild(\s|$)/.test(p.cmd));
	const anyBooted = procs.find((p) => /\bsimctl\b.*\sbooted(\s|$)/.test(p.cmd));
	for (const s of sims) {
		const own = `/${s.udid}/data/`;
		// An app's main binary sits directly in its .app; widgets and other
		// extensions (PlugIns/*.appex) run on their own and do not count.
		const app = new RegExp(`/${s.udid}/data/Containers/Bundle/Application/[^/]+/[^/]+\\.app/[^/\\s]+(\\s|$)`);
		s.appRunning = procs.some((p) => app.test(p.cmd));
		const client = procs.find((p) => !p.cmd.includes(own) && (p.cmd.includes(s.udid) || p.cmd.includes(`name=${s.name}`)));
		s.client = client ? client.pid : s.set === "testing" ? xcodebuild?.pid : anyBooted?.pid;
	}
	return sims;
}

// The ids of every running Claude session: the current id, and for a background
// session its job's id and the ids it started and resumed under. null when Claude
// Code does not answer or lists no running session, so nothing is judged ended.
export function liveSessionIds(list = null) {
	try {
		list ??= JSON.parse(run(CLAUDE, ["agents", "--json"], { timeout: 30000 }));
	} catch {
		return null;
	}
	if (!Array.isArray(list)) return null;
	const ids = new Set();
	for (const a of list) {
		if (!a.pid) continue;
		for (const id of [a.sessionId, a.id]) if (id) ids.add(id);
		if (a.kind !== "background" || !a.id) continue;
		try {
			const st = JSON.parse(readFileSync(join(JOBS, a.id, "state.json"), "utf8"));
			for (const id of [st.sessionId, st.resumeSessionId]) if (id) ids.add(id);
		} catch {}
	}
	return ids.size ? ids : null;
}

// Shut-down simulators whose last user was a Claude session that has ended, as
// the session's agent-Chrome window closes with it. One a tool asks for by name
// (Xcode's own "iPhone 17 Pro", the PiP one) is emptied with `simctl erase`; one an
// agent made for its task is deleted. A simulator no Claude session recorded (yours,
// Codex's) is left alone, and so is one used in the last SIM_OWNER_GRACE_MS, since a
// recompact gives a running session a new id that its next use records.
export function endedSessionSims(live, now = Date.now(), usersDir = SIM_USERS, list = null) {
	if (!live) return [];
	let devices, types;
	try {
		list ??= JSON.parse(simctl(["list", "-j", "devices", "devicetypes"]));
		devices = Object.values(list.devices ?? {}).flat();
		types = new Map((list.devicetypes ?? []).map((t) => [t.identifier, t.name]));
	} catch {
		return [];
	}
	const out = [];
	for (const d of devices) {
		if (d.state !== "Shutdown" || d.isAvailable === false) continue;
		const file = join(usersDir, d.udid);
		let owner, usedAt;
		try {
			owner = readFileSync(file, "utf8").trim();
			usedAt = statSync(file).mtimeMs;
		} catch {
			continue;
		}
		if (!owner || isLive(live, owner)) continue;
		if (now - usedAt < SIM_OWNER_GRACE_MS) continue;
		const shared = SHARED_SIMS.has(d.name) || types.get(d.deviceTypeIdentifier) === d.name;
		out.push({ udid: d.udid, name: d.name, owner, usedAt, file, action: shared ? "erase" : "delete" });
	}
	return out;
}

const isLive = (live, owner) => live.has(owner) || [...live].some((id) => id.length === 8 && owner.startsWith(`${id}-`));

// Each Android phone's (AVD's) last launch: the port it ran on (-port, else the
// emulator's first, 5554) and when. emu-launch-params.txt holds the arguments, one a line.
export function avdLaunches(dir = AVD_DIR) {
	const out = [];
	let names;
	try {
		names = readdirSync(dir).filter((f) => f.endsWith(".ini")).map((f) => f.slice(0, -4));
	} catch {
		return out;
	}
	for (const name of names) {
		const path = join(dir, `${name}.avd`);
		try {
			const file = join(path, "emu-launch-params.txt");
			const args = readFileSync(file, "utf8").split("\n").map((s) => s.trim());
			const i = args.indexOf("-port");
			out.push({ name, path, port: i >= 0 ? Number(args[i + 1]) : 5554, launchedAt: statSync(file).mtimeMs });
		} catch {}
	}
	return out;
}

// Android phones whose last user was a Claude session that has ended, as for
// simulators. An emulator is recorded by port (android:emulator-<port>); the phone
// is the one last launched on that port before that use, and a later launch of it
// was someone else's. Phones are started by name (the nightly job's
// sideshift-api36-e), so one is wiped back to factory data, never deleted; a
// running one is stopped first and wiped on a later run.
export function endedSessionAvds(live, now = Date.now(), usersDir = SIM_USERS, launches = avdLaunches(), procs = processes()) {
	if (!live) return [];
	let files;
	try {
		files = readdirSync(usersDir).filter((f) => /^android:emulator-\d+$/.test(f));
	} catch {
		return [];
	}
	const out = [];
	for (const f of files) {
		const port = Number(f.slice("android:emulator-".length));
		const file = join(usersDir, f);
		let owner, usedAt;
		try {
			owner = readFileSync(file, "utf8").trim();
			usedAt = statSync(file).mtimeMs;
		} catch {
			continue;
		}
		if (!owner || isLive(live, owner) || now - usedAt < SIM_OWNER_GRACE_MS) continue;
		const avd = launches.filter((l) => l.port === port && l.launchedAt <= usedAt).sort((a, b) => b.launchedAt - a.launchedAt)[0];
		if (!avd) continue;
		const avdArg = new RegExp(`\\s-avd\\s+${avd.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
		const proc = procs.find((p) => avdArg.test(p.cmd));
		out.push({ ...avd, owner, usedAt, file, serial: `emulator-${port}`, running: proc ? proc.pid : null });
	}
	return out;
}

function lsofFields(pids, args) {
	const out = {};
	let pid, name;
	for (const line of run("/usr/sbin/lsof", ["-nP", "-a", "-p", pids.join(","), ...args, "-FpnT"]).split("\n")) {
		if (line[0] === "p") pid = +line.slice(1);
		else if (line[0] === "n") (out[pid] ??= []).push((name = { name: line.slice(1) }));
		else if (line.startsWith("TST=") && name) name.state = line.slice(4);
	}
	return out;
}

// Physical footprint (what Activity Monitor shows), from proc_pid_rusage. RSS
// shrinks as macOS compresses a process's pages: a dev server with a 15.6 GB
// footprint read as 4.8 GB of RSS. `top` reports it too, but takes 14 s.
const FOOTPRINT_PY = `import ctypes, sys
lib = ctypes.CDLL("/usr/lib/libproc.dylib")
class RU(ctypes.Structure):
    _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [(n, ctypes.c_uint64) for n in ("user", "system", "idle", "intr", "pageins", "wired", "resident", "footprint", "start", "exit")]
for p in sys.argv[1:]:
    r = RU()
    if lib.proc_pid_rusage(int(p), 0, ctypes.byref(r)) == 0:
        print(p, r.footprint // 1024)`;

function footprintKB(pids) {
	const out = {};
	for (const line of run("/usr/bin/python3", ["-I", "-c", FOOTPRINT_PY, ...pids.map(String)]).split("\n")) {
		const [pid, kb] = line.split(" ").map(Number);
		if (pid) out[pid] = kb;
	}
	return out;
}

// Running emulators, with the session tool that last named each one (sim-owner.mjs) and
// whether a test run or adb command is using it now.
export function bloatedEmulators(procs = processes(), now = Date.now(), usersDir = SIM_USERS) {
	const out = [];
	for (const p of procs) {
		if (!/\/qemu-system-[\w-]+\s.*-avd\s/.test(p.cmd)) continue;
		const port = Number(p.cmd.match(/\s-port\s+(\d+)/)?.[1] ?? 5554);
		const serial = `emulator-${port}`;
		let usedAt = null;
		try {
			usedAt = statSync(join(usersDir, `android:${serial}`)).mtimeMs;
		} catch {}
		// Session Board's screen stream (android-stream.mjs) stays open for as long as its tab does, so it is not use.
		const busy = procs.some((q) => q.pid !== p.pid && !/android-stream\.mjs/.test(q.cmd)
			&& (q.cmd.includes(serial) || /connected\w*AndroidTest|(^|\/)maestro\s/.test(q.cmd)));
		out.push({ pid: p.pid, avd: p.cmd.match(/\s-avd\s+(\S+)/)?.[1], serial, usedAt, busy });
	}
	return out;
}

// CPU seconds each process has used so far (ps TIME: [[dd-]hh:]mm:ss.ss).
function cpuSeconds(pids) {
	const out = {};
	for (const line of run("/bin/ps", ["-o", "pid=,time=", "-p", pids.join(",")]).split("\n")) {
		const [pid, t] = line.trim().split(/\s+/);
		if (!pid || !t) continue;
		const [d, rest] = t.includes("-") ? t.split("-") : ["0", t];
		out[+pid] = rest.split(":").reduce((s, x) => s * 60 + Number(x), 0) + Number(d) * 86400;
	}
	return out;
}

export function devServers(procs = processes()) {
	const byPid = new Map(procs.map((p) => [p.pid, p]));
	const servers = [];
	for (const p of procs) {
		if (!/^next-server \(v/.test(p.cmd)) continue;
		// The `next dev` launcher above the server: stopping it stops the server.
		let root = p;
		for (let q = byPid.get(p.ppid); q && /(^|[\s/])next\s+dev(\s|$)/.test(q.cmd); q = byPid.get(q.ppid)) root = q;
		const pids = [...new Set([p.pid, root.pid])];
		servers.push({ pid: p.pid, rootPid: root.pid, pids, ageSec: root.ageSec, owner: owner(root.pid, byPid) });
	}
	if (!servers.length) return servers;
	const all = servers.flatMap((s) => s.pids);
	const tcp = lsofFields(all, ["-iTCP", "-sTCP:LISTEN,ESTABLISHED"]);
	const cwd = lsofFields(all, ["-d", "cwd"]);
	const mem = footprintKB(all);
	for (const s of servers) {
		s.memKB = s.pids.reduce((n, x) => n + (mem[x] ?? byPid.get(x).rssKB), 0);
		const socks = s.pids.flatMap((x) => tcp[x] ?? []);
		s.ports = [...new Set(socks.filter((k) => k.state === "LISTEN").map((k) => +k.name.match(/:(\d+)$/)?.[1]).filter(Boolean))];
		// Inbound only: the server's own outbound calls (Firestore, Postgres) do not count.
		s.clients = socks.filter((k) => k.state === "ESTABLISHED" && s.ports.includes(+k.name.match(/:(\d+)->/)?.[1])).length;
		s.checkout = inCheckout(cwd[s.pid]?.[0]?.name);
		s.cwd = (cwd[s.pid]?.[0]?.name ?? "?").replace(HOME, "~");
	}
	// A dev server runs in a checkout. The shiftpool gateway is a Next server too
	// (launchd starts it from ~/.shiftpool-client), and stopping it cuts every session.
	return servers.filter((s) => s.checkout);
}

function inCheckout(dir) {
	for (let d = dir; d && d !== "/"; d = dirname(d)) if (existsSync(join(d, ".git"))) return true;
	return false;
}

// Claude Code runs each Bash tool call, background tasks included, in this shell.
const TASK_SHELL = /^\/bin\/(zsh|bash) -c source \S*\/\.claude\/shell-snapshots\/snapshot-/;
const PTY_HELPER = /\/node-pty\/build\/Release\/spawn-helper(\s|$)/;

// Task shells and pty helpers whose parent is gone, each with its process tree.
export function orphans(procs = processes()) {
	const kids = new Map();
	for (const p of procs) {
		if (!kids.has(p.ppid)) kids.set(p.ppid, []);
		kids.get(p.ppid).push(p);
	}
	const out = [];
	for (const p of procs) {
		if (p.ppid !== 1) continue;
		const kind = TASK_SHELL.test(p.cmd) ? "task" : PTY_HELPER.test(p.cmd) ? "pty" : null;
		if (!kind) continue;
		const tree = [];
		for (const stack = [p]; stack.length; ) {
			const q = stack.pop();
			tree.push(q);
			stack.push(...(kids.get(q.pid) ?? []));
		}
		out.push({ pid: p.pid, kind, ageSec: p.ageSec, cmd: p.cmd, tree });
	}
	if (!out.length) return out;
	const tcp = lsofFields(out.flatMap((o) => o.tree.map((q) => q.pid)), ["-iTCP", "-sTCP:LISTEN,ESTABLISHED"]);
	for (const o of out) {
		const socks = o.tree.flatMap((q) => tcp[q.pid] ?? []);
		const ports = socks.filter((k) => k.state === "LISTEN").map((k) => +k.name.match(/:(\d+)$/)?.[1]).filter(Boolean);
		o.clients = socks.filter((k) => k.state === "ESTABLISHED" && ports.includes(+k.name.match(/:(\d+)->/)?.[1])).length;
		o.devServer = o.tree.some((q) => /^next-server \(v/.test(q.cmd));
		// Program names only: a task's command line can carry secrets.
		o.running = [...new Set(o.tree.slice(1).map((q) => q.cmd.split(/\s/)[0].split("/").pop()))].join(", ") || "nothing";
	}
	return out;
}

function killTree(pids) {
	for (const pid of pids) try { process.kill(pid, "SIGTERM"); } catch {}
	execFileSync("/bin/sleep", ["3"]);
	for (const pid of pids) try { process.kill(pid, "SIGKILL"); } catch {}
}

// The Docker Engine API on the default Colima VM's socket. null when it is down.
function docker(method, path, timeout = 10000) {
	return new Promise((resolve) => {
		const req = request({ socketPath: DOCKER_SOCK, method, path, timeout }, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (c) => (body += c));
			res.on("end", () => {
				if (res.statusCode >= 400) return resolve(null);
				try {
					resolve(body ? JSON.parse(body) : {});
				} catch {
					resolve(null);
				}
			});
		});
		req.on("error", () => resolve(null));
		req.on("timeout", () => {
			req.destroy();
			resolve(null);
		});
		req.end();
	});
}

// Running containers with their total network bytes (null: no network to watch).
export async function containers() {
	const list = await docker("GET", "/containers/json");
	if (!Array.isArray(list)) return null;
	return Promise.all(
		list.map(async (c) => {
			const [stats, info] = await Promise.all([
				docker("GET", `/containers/${c.Id}/stats?stream=false&one-shot=true`),
				docker("GET", `/containers/${c.Id}/json`),
			]);
			const nets = Object.values(stats?.networks ?? {});
			return {
				id: c.Id,
				name: (c.Names?.[0] ?? c.Id).replace(/^\//, ""),
				image: c.Image,
				startedAt: Date.parse(info?.State?.StartedAt) || null,
				// Stopping an --rm container deletes it and its anonymous volumes.
				autoRemove: info?.HostConfig?.AutoRemove !== false,
				io: nets.length ? nets.reduce((n, x) => n + (x.rx_bytes ?? 0) + (x.tx_bytes ?? 0), 0) : null,
			};
		}),
	);
}

async function cdp(wsUrl, method, params = {}) {
	return new Promise((resolve) => {
		let ws;
		const done = (v) => {
			clearTimeout(timer);
			try { ws?.close(); } catch {}
			resolve(v);
		};
		const timer = setTimeout(() => done(null), 4000);
		try {
			ws = new WebSocket(wsUrl);
		} catch {
			return done(null);
		}
		ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
		ws.onmessage = (e) => {
			const m = JSON.parse(e.data);
			if (m.id === 1) done(m.error ? null : m.result);
		};
		ws.onerror = () => done(null);
	});
}

async function chromeTabs() {
	try {
		const [list, version] = await Promise.all(
			["/json/list", "/json/version"].map((p) => fetch(CHROME + p, { signal: AbortSignal.timeout(3000) }).then((r) => r.json())),
		);
		const tabs = list.filter((t) => t.type === "page");
		await Promise.all(tabs.map(async (t) => {
			const r = await cdp(t.webSocketDebuggerUrl, "Runtime.evaluate", { expression: "performance.timeOrigin", returnByValue: true });
			t.loadedAt = typeof r?.result?.value === "number" ? Math.round(r.result.value) : null;
		}));
		return { tabs, browserWs: version.webSocketDebuggerUrl };
	} catch {
		return null; // the agent Chrome is not running
	}
}

// Running background sessions, with when their job state last changed (the time
// Claude Code counts idleness from). null when Claude Code does not answer.
export function runningSessions() {
	let list;
	try {
		list = JSON.parse(run(CLAUDE, ["agents", "--json"], { timeout: 30000 }));
	} catch {
		return null;
	}
	const out = [];
	for (const a of list) {
		// The Session Board's e2e suite runs throwaway sessions under ~/Library/Caches.
		if (a.kind !== "background" || !a.id || !a.pid || a.cwd?.startsWith(join(HOME, "Library/Caches/"))) continue;
		try {
			const updatedAt = Date.parse(JSON.parse(readFileSync(join(JOBS, a.id, "state.json"), "utf8")).updatedAt);
			if (updatedAt) out.push({ id: a.id, pid: a.pid, name: a.name ?? a.id, updatedAt });
		} catch {}
	}
	return out;
}

// Claude Code's pin list. A missing file is empty; an unreadable one throws, so
// nobody's pins are overwritten.
function readPins() {
	let text;
	try {
		text = readFileSync(PINS, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return new Set();
		throw err;
	}
	const list = JSON.parse(text);
	if (!Array.isArray(list)) throw new Error("pins.json is not a list");
	return new Set(list.filter((x) => typeof x === "string"));
}

// Claude Code writes pins.json under a proper-lockfile lock: the directory
// pins.json.lock, stale after 5 s.
function updatePins(add, drop) {
	const lock = `${PINS}.lock`;
	for (let i = 0; ; i++) {
		try {
			mkdirSync(lock);
			break;
		} catch (err) {
			if (err.code !== "EEXIST" || i >= 100) throw err;
			try {
				if (Date.now() - statSync(lock).mtimeMs > 5000) rmdirSync(lock);
			} catch {}
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
		}
	}
	try {
		const pins = readPins();
		for (const id of add) pins.add(id);
		for (const id of drop) pins.delete(id);
		writeFileSync(`${PINS}.reaper`, JSON.stringify([...pins], null, 2));
		renameSync(`${PINS}.reaper`, PINS);
	} finally {
		rmdirSync(lock);
	}
}

const ago = (ms) => (ms >= 5400e3 ? `${(ms / 3600e3).toFixed(1)} h` : `${Math.round(ms / 60e3)} min`);
const gb = (kb) => `${(kb / 1048576).toFixed(1)} GB`;

function stamp() {
	const d = new Date();
	const z = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
}

async function main() {
	const dry = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
	const now = Date.now();
	let state = {};
	try {
		state = JSON.parse(readFileSync(STATE, "utf8"));
	} catch {}
	const next = { sims: {}, dev: {}, tabs: {}, orphans: {}, containers: {}, kotlin: {} };
	const lines = [];
	const pending = [];
	const say = (line) => lines.push(line);
	const act = (line, fn) => {
		say(`${dry ? "WOULD " : ""}${line}`);
		if (!dry) {
			try {
				const r = fn();
				if (r?.then) pending.push(r);
			} catch (err) {
				say(`  failed: ${err.message}`);
			}
		}
	};

	const procs = processes();

	for (const s of bootedSims(procs)) {
		const st = (next.sims[s.udid] = { ...(state.sims?.[s.udid] ?? { firstSeen: now }) });
		if (s.client) st.lastClient = now;
		if (s.appRunning) st.lastApp = now;
		const booted = s.bootedAt ?? st.firstSeen;
		const label = `simulator "${s.name}" (${s.udid}${s.set === "testing" ? ", test clone" : ""})`;
		const idle = now - Math.max(booted, st.lastClient ?? 0, st.lastApp ?? 0);
		const untended = now - Math.max(booted, st.lastClient ?? 0);
		let why = null;
		if (s.client) why = null;
		else if (s.set === "testing") why = untended > SIM_CLONE_MS && `test clone, no xcodebuild for ${ago(untended)}`;
		else if (!s.appRunning) why = idle > SIM_IDLE_MS && `nothing has run in it for ${ago(idle)}`;
		else why = untended > SIM_APP_MS && `an app has sat open with no tool attached for ${ago(untended)}`;
		if (why) act(`SHUTDOWN ${label}: ${why}`, () => simctl([...(s.set === "testing" ? ["--set", "testing"] : []), "shutdown", s.udid]));
		else if (dry) say(`keep ${label}: ${s.client ? `in use (pid ${s.client})` : s.appRunning ? "app running" : `idle ${ago(idle)}`}`);
	}

	const live = liveSessionIds();
	for (const a of endedSessionAvds(live, now, SIM_USERS, avdLaunches(), procs)) {
		const label = `Android phone "${a.name}" (${a.serial}), last used ${ago(now - a.usedAt)} ago by ended session ${a.owner}`;
		if (a.running)
			act(`STOP ${label}`, () => {
				if (existsSync(ADB)) run(ADB, ["-s", a.serial, "emu", "kill"], { timeout: 30000 });
				else process.kill(a.running, "SIGTERM");
			});
		else
			act(`WIPE ${label}`, () => {
				for (const f of AVD_DATA) rmSync(join(a.path, f), { recursive: true, force: true });
				rmSync(a.file, { force: true });
			});
	}

	const big = bloatedEmulators(procs, now);
	const emuKB = big.length ? footprintKB(big.map((e) => e.pid)) : {};
	for (const e of big) {
		const kb = emuKB[e.pid] ?? 0;
		const label = `Android emulator ${e.serial} (AVD ${e.avd}, pid ${e.pid}, ${gb(kb)}), last used ${e.usedAt ? `${ago(now - e.usedAt)} ago` : "never recorded"}`;
		const idle = !e.usedAt || now - e.usedAt > EMU_IDLE_MS;
		if (kb > EMU_MAX_KB && idle && !e.busy)
			act(`STOP ${label}: over the ${gb(EMU_MAX_KB)} limit; its session gets a fresh one on its next launch`, () => {
				if (existsSync(ADB)) run(ADB, ["-s", e.serial, "emu", "kill"], { timeout: 30000 });
				else process.kill(e.pid, "SIGTERM");
			});
		else if (dry) say(`keep ${label}: ${kb <= EMU_MAX_KB ? "under the limit" : e.busy ? "a build or test is using it" : "used recently"}`);
	}

	const kotlin = procs.filter((p) => /KotlinCompileDaemon|kotlin-daemon/.test(p.cmd));
	const ktKB = kotlin.length ? footprintKB(kotlin.map((p) => p.pid)) : {};
	const ktCpu = kotlin.length ? cpuSeconds(kotlin.map((p) => p.pid)) : {};
	for (const p of kotlin) {
		const kb = ktKB[p.pid] ?? 0;
		const prev = state.kotlin?.[p.pid];
		const cpu = ktCpu[p.pid] ?? 0;
		// Idle = no compile since the last run: CPU time moved by under 2 s.
		const quiet = prev && cpu - prev.cpu < 2;
		const since = quiet ? prev.quietSince ?? prev.seenAt : now;
		next.kotlin[p.pid] = { cpu, seenAt: now, quietSince: since };
		const label = `Kotlin compiler daemon (pid ${p.pid}, ${gb(kb)}, up ${ago(p.ageSec * 1000)})`;
		if (kb > KOTLIN_MAX_KB && quiet && now - since >= 4 * 60e3)
			act(`STOP ${label}: over the ${gb(KOTLIN_MAX_KB)} limit and no compile for ${ago(now - since)}; the next build starts a new one`, () =>
				process.kill(p.pid, "SIGTERM"));
		else if (dry) say(`keep ${label}: ${kb <= KOTLIN_MAX_KB ? "under the limit" : quiet ? `quiet ${ago(now - since)}` : "compiling"}`);
	}

	for (const s of endedSessionSims(live)) {
		const label = `simulator "${s.name}" (${s.udid}), last used ${ago(now - s.usedAt)} ago by ended session ${s.owner}`;
		const verb = s.action === "erase" ? "ERASE" : "DELETE";
		act(`${verb} ${label}`, () => {
			// A 49 GB simulator takes longer than simctl()'s 30 s to delete.
			run("/usr/bin/xcrun", ["simctl", s.action, s.udid], { env: XCODE_ENV, timeout: 600000 });
			rmSync(s.file, { force: true });
		});
	}

	for (const s of devServers(procs)) {
		const prev = state.dev?.[s.rootPid];
		const started = now - s.ageSec * 1000;
		// A pid seen before with a different start time is a new process.
		const st = (next.dev[s.rootPid] = prev && Math.abs(prev.started - started) < 60e3 ? { ...prev } : { started });
		if (s.clients) st.lastClient = now;
		const label = `dev server :${s.ports.join(",:") || "?"} in ${s.cwd} (pid ${s.rootPid}, ${s.owner}, ${gb(s.memKB)})`;
		const idle = now - Math.max(st.started, st.lastClient ?? 0);
		let why = null;
		if (s.owner === "terminal") why = null;
		else if (s.memKB > DEV_MAX_KB) why = `using ${gb(s.memKB)}, over the ${gb(DEV_MAX_KB)} limit`;
		else if (!s.clients && idle > DEV_IDLE_MS) why = `no client connected for ${ago(idle)}`;
		if (why) {
			act(`STOP ${label}: ${why}`, () => {
				for (const pid of [s.rootPid, s.pid]) try { process.kill(pid, "SIGTERM"); } catch {}
				execFileSync("/bin/sleep", ["5"]);
				for (const pid of [s.rootPid, s.pid]) try { process.kill(pid, "SIGKILL"); } catch {}
			});
			delete next.dev[s.rootPid];
		} else if (dry) say(`keep ${label}: ${s.owner === "terminal" ? "yours" : s.clients ? `${s.clients} client(s) connected` : `idle ${ago(idle)}`}`);
	}

	for (const o of orphans(procs)) {
		const started = now - o.ageSec * 1000;
		const prev = state.orphans?.[o.pid];
		// Orphaned time counts from the first run that saw it orphaned.
		const st = (next.orphans[o.pid] = prev && Math.abs(prev.started - started) < 60e3 ? { ...prev } : { started, seen: now });
		const label =
			o.kind === "task"
				? `orphaned background task (pid ${o.pid}, running: ${o.running}, up ${ago(o.ageSec * 1000)})`
				: `orphaned pty helper (pid ${o.pid}) from ${o.cmd.split("/node_modules/")[0].replace(HOME, "~")}`;
		const orphaned = now - st.seen;
		const keep = o.devServer
			? "runs a dev server (the dev-server rule decides)"
			: o.clients
				? `${o.clients} client(s) connected`
				: orphaned < ORPHAN_MS && `orphaned for ${ago(orphaned)}`;
		if (!keep) {
			act(`KILL ${label}: its session is gone, so nothing can read its output`, () => killTree(o.tree.map((q) => q.pid)));
			delete next.orphans[o.pid];
		} else if (dry) say(`keep ${label}: ${keep}`);
	}

	const cons = await containers();
	for (const c of cons ?? []) {
		const prev = state.containers?.[c.id];
		// Idle time counts from the last run that saw real traffic. Bridge chatter
		// (ARP, IPv6 neighbour discovery) reaches every container whenever another one
		// starts: tens of bytes, so only CONTAINER_ACTIVE_BYTES since the last run count.
		const used = !prev || c.io === null || c.io < prev.io || c.io - prev.io >= CONTAINER_ACTIVE_BYTES;
		const st = (next.containers[c.id] = { io: c.io, changed: used ? now : prev.changed });
		const label = `container ${c.name} (${c.image}, up ${c.startedAt ? ago(now - c.startedAt) : "?"})`;
		const idle = now - st.changed;
		const keep = KEEP_CONTAINERS.has(c.name)
			? "kept by name"
			: c.autoRemove
				? "started with --rm, so stopping would delete it"
				: c.io === null
					? "no network to watch"
					: idle <= CONTAINER_IDLE_MS && `no traffic for ${ago(idle)}`;
		if (!keep) {
			act(`STOP ${label}: no network traffic for ${ago(idle)}; \`docker start ${c.name}\` brings it back with its data`, () =>
				// Docker waits up to t seconds for a clean exit before it kills.
				docker("POST", `/containers/${c.id}/stop?t=30`, 45000),
			);
			delete next.containers[c.id];
		} else if (dry) say(`keep ${label}: ${keep}`);
	}
	if (!cons) next.containers = state.containers ?? {};

	const chrome = await chromeTabs();
	for (const t of chrome?.tabs ?? []) {
		const prev = state.tabs?.[t.id];
		// A tab first seen now counts from its page load, so old tabs are not
		// granted a fresh idle limit. A URL change (client-side navigation) is use.
		const st = (next.tabs[t.id] = !prev ? { url: t.url, changed: t.loadedAt ?? now } : prev.url !== t.url ? { url: t.url, changed: now } : { ...prev });
		const label = `agent Chrome tab "${t.title.slice(0, 60)}" (${t.url.slice(0, 80)})`;
		const idle = now - Math.max(st.changed, t.loadedAt ?? now);
		if (t.loadedAt !== null && idle > TAB_IDLE_MS) {
			act(`CLOSE ${label}: unused for ${ago(idle)}`, () => cdp(chrome.browserWs, "Target.closeTarget", { targetId: t.id }));
			delete next.tabs[t.id];
		} else if (dry) say(`keep ${label}: ${t.loadedAt === null ? "page did not answer" : `idle ${ago(idle)}`}`);
	}
	if (!chrome) next.tabs = state.tabs ?? {};

	// next.pins: the sessions this reaper pinned, by id.
	const sessions = runningSessions();
	next.pins = {};
	try {
		if (!sessions) throw new Error("claude agents did not answer");
		const pins = readPins();
		const add = [];
		const drop = [];
		for (const s of sessions) {
			const mine = state.pins?.[s.id];
			const label = `session "${s.name}" (${s.id})`;
			const idle = now - s.updatedAt;
			if (mine && (mine.released || !pins.has(s.id))) {
				// Unpinned by hand: it stays unpinned until its process restarts.
				if (mine.pid === s.pid) next.pins[s.id] = { pid: s.pid, released: true };
			} else if (!mine && pins.has(s.id)) {
				if (dry) say(`keep ${label}: pinned by hand`);
			} else if (idle >= AWAKE_MS) {
				if (mine) act(`UNPIN ${label}: idle ${ago(idle)}, so Claude Code stops it within a minute`, () => drop.push(s.id));
			} else if (mine) {
				next.pins[s.id] = mine;
				if (dry) say(`keep ${label}: pinned, idle ${ago(idle)}`);
			} else {
				act(`PIN ${label}: keep it running until it has been idle ${ago(AWAKE_MS)}`, () => add.push(s.id));
				next.pins[s.id] = { pid: s.pid };
			}
		}
		const running = new Set(sessions.map((s) => s.id));
		for (const [id, mine] of Object.entries(state.pins ?? {}))
			if (!running.has(id) && !mine.released && pins.has(id)) act(`UNPIN session ${id}: no longer running`, () => drop.push(id));
		if (add.length || drop.length) updatePins(add, drop);
	} catch (err) {
		if (sessions) say(`  pins not updated: ${err.message}`);
		next.pins = state.pins ?? {};
	}
	if (dry) next.pins = state.pins ?? {};

	await Promise.all(pending);
	mkdirSync(dirname(STATE), { recursive: true });
	writeFileSync(STATE, JSON.stringify(next, null, 1));

	if (dry) {
		console.log(lines.join("\n") || "nothing running");
		return;
	}
	const acted = lines.filter((l) => !l.startsWith("keep"));
	if (!acted.length) return;
	mkdirSync(dirname(LOG), { recursive: true });
	appendFileSync(LOG, acted.map((l) => `${stamp()} ${l}\n`).join(""));
	try {
		const all = readFileSync(LOG, "utf8").split("\n");
		if (all.length > 2000) writeFileSync(LOG, all.slice(-2000).join("\n"));
	} catch {}
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
