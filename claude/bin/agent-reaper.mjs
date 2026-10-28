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
//                for SESSION_AWAKE_HOURS (12). Claude Code stops one after an idle
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
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
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
const ORPHAN_MS = env("ORPHAN_MIN", 30) * 60e3;
const CONTAINER_IDLE_MS = env("CONTAINER_IDLE_HOURS", 24) * 3600e3;
const CONTAINER_ACTIVE_BYTES = 16 * 1024;
const KEEP_CONTAINERS = new Set(["sideshift-pg-local", ...(process.env.KEEP_CONTAINERS ?? "").split(",").filter(Boolean)]);
const AWAKE_MS = env("SESSION_AWAKE_HOURS", 12) * 3600e3;
const CLAUDE = join(HOME, ".local/bin/claude");
const JOBS = join(HOME, ".claude/jobs");
const PINS = join(JOBS, "pins.json");
const DOCKER_SOCK = join(HOME, ".colima/default/docker.sock");
const CHROME = `http://127.0.0.1:${process.env.AGENT_CHROME_PORT || 9222}`;
const STATE = join(HOME, ".cache/agent-reaper/state.json");
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
	const next = { sims: {}, dev: {}, tabs: {}, orphans: {}, containers: {} };
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
