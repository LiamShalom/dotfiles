#!/usr/bin/env node
// Stop: refuse to end a turn while this session still runs things that never stop on their own:
// dev servers, tunnels and proxies, watchers, infinite loops, emulators, a launched browser, and
// simulators it booted. CLAUDE.md says "clean up what you started before you finish a task"; the
// agent reaper only catches leftovers hours later, after they have held memory and ports.
//
// Ownership is exact, not guessed: every process an agent starts inherits CLAUDE_CODE_SESSION_ID,
// including ones detached with nohup or `&`, so `ps -E` names the session that started it.
// Simulators are attributed through ~/.cache/agent-sims/<udid> (session-board's sim-owner.mjs).
//
// Blocks once per leftover: what it already reported is kept in ~/.cache/cleanup-check/<session>.json,
// so a thing kept on purpose (a server or simulator Liam is looking at) is named once, the agent says
// why it stays, and later turns are not sent back for it again. Headless runs are skipped.
//
//   node cleanup-check.mjs --list [session-id]   print this (or that) session's leftovers, block nothing
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const SIM_USERS = join(HOME, ".cache/agent-sims");
const STATE_DIR = join(HOME, ".cache/cleanup-check");

// kind, pattern on the command line (never on the environment), how to stop it
export const RULES = [
	["dev server", /\bnext(\.js)?\s+(dev|start)\b|\bnext-server\b|\bnpm\s+(run\s+)?(dev|start)\b|\b(pnpm|yarn|bun)\s+(run\s+)?dev\b|\b(vite|astro|nuxt|remix)\s+(dev|preview)\b|\/vite(\.js)?(\s|$)|\bexpo\s+start\b|\bstorybook\s+dev\b|\bstart-storybook\b|\bfirebase\s+emulators:start\b|\bwrangler\s+dev\b|\bvercel\s+dev\b|\bturbo\s+(run\s+)?dev\b|\bhttp\.server\b|\bhttp-server\b|\bnpx\s+serve\b|\bmetro\b.*\bstart\b|\bgradlew\b.*--continuous/],
	["tunnel/proxy", /\bcloud[-_]sql[-_]proxy\b|\bngrok\b|\bcloudflared\b|\bstripe\s+listen\b|\bkubectl\s+port-forward\b|(^|[\s/])ssh\s.*\s-[a-zA-Z]*[LRND]\b|\bgcloud\b.*\b(start-iap-tunnel|proxy)\b/],
	["watcher", /\btail\b[^|;&]*\s-[a-zA-Z]*[fF]\b|\s--watch(?!=false)\b|\bwatch\s+-n\b|\s--reload\b|\btsc\b.*\s-w\b|\bnodemon\b|\bchokidar\b|\bfswatch\b|\blog\s+stream\b|\badb\b.*\blogcat\b/],
	// A loop with a break or exit is a wait that ends; only an unconditional one is a leftover.
	["infinite loop", /^(?!.*\b(break|exit)\b).*\bwhile\s+(true|:|sleep\b)/],
	["Android emulator", /\bqemu-system-\S+|\/emulator\/emulator\s/],
	["browser", /Chrome for Testing|chrome-headless-shell|--headless(=new)?\b.*--remote-debugging|--remote-debugging-port=(?!9222\b)\d+/],
	["container", /\bdocker\s+(run|start|compose\b.*\bup)\b/],
];
// Never ours to report: the harness's own servers and tools, and CI waits that end by themselves.
const IGNORE = /\bgh\s+(pr|run)\b|\bmcp\b|mcp-|-mcp|\/\.claude\/(hooks|bin)\/|claude\/versions\/|\bclaude\s+(bg|daemon|-p)\b|session-board/i;

function run(file, args, opts = {}) {
	try {
		return execFileSync(file, args, { encoding: "utf8", maxBuffer: 64 << 20, timeout: 5000, stdio: ["ignore", "pipe", "ignore"], ...opts });
	} catch (err) {
		return err.stdout ?? "";
	}
}

export function parsePs(text) {
	const out = [];
	for (const line of text.split("\n")) {
		const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
		if (m) out.push({ pid: +m[1], ppid: +m[2], cmd: m[3] });
	}
	return out;
}

// pids whose environment carries this session id
export function sessionPids(envText, sid) {
	const needle = `CLAUDE_CODE_SESSION_ID=${sid}`;
	const pids = new Set();
	for (const line of envText.split("\n")) {
		if (!line.includes(needle)) continue;
		const m = line.match(/^\s*(\d+)\s/);
		if (m) pids.add(+m[1]);
	}
	return pids;
}

// The Bash tool wraps each command as `zsh -c source <snapshot> … eval '<command>'`; match on the command.
const shown = (cmd) => {
	const m = cmd.match(/\beval '(.*)' < \/dev\/null/s);
	return (m ? m[1].replace(/'"'"'/g, "'") : cmd).replace(/\s+/g, " ").trim();
};

export function leftovers(procs, owned, exclude = new Set()) {
	const kindOf = new Map();
	for (const p of procs) {
		if (!owned.has(p.pid) || exclude.has(p.pid) || IGNORE.test(p.cmd)) continue;
		const cmd = shown(p.cmd);
		const rule = RULES.find(([, re]) => re.test(cmd));
		if (rule) kindOf.set(p.pid, rule[0]);
	}
	const byPid = new Map(procs.map((p) => [p.pid, p]));
	const found = [];
	for (const [pid, kind] of kindOf) {
		// Report the top of each tree once: `npm run dev` stands for its next-server.
		let covered = false;
		for (let p = byPid.get(byPid.get(pid)?.ppid), hops = 0; p && hops < 32; p = byPid.get(p.ppid), hops++) {
			if (kindOf.has(p.pid)) { covered = true; break; }
		}
		if (covered) continue;
		let top = pid;
		for (let p = byPid.get(byPid.get(pid)?.ppid), hops = 0; p && hops < 32 && owned.has(p.pid) && !exclude.has(p.pid); p = byPid.get(p.ppid), hops++) top = p.pid;
		// Kill the whole tree, children first: killing a Bash-tool shell alone leaves its server running.
		const tree = [];
		const walk = (p, depth) => {
			if (depth > 32) return;
			for (const c of procs) if (c.ppid === p) walk(c.pid, depth + 1);
			tree.push(p);
		};
		walk(top, 0);
		const what = shown(byPid.get(pid).cmd).slice(0, 160);
		// Keyed by what it is, not its pid: a child that a loop respawns is the same leftover.
		found.push({ id: `${kind}:${what}`, kind, what, stop: `kill ${tree.join(" ")}` });
	}
	return found;
}

function ancestors(procs, pid) {
	const byPid = new Map(procs.map((p) => [p.pid, p]));
	const out = new Set();
	for (let p = byPid.get(pid), hops = 0; p && hops < 64; p = byPid.get(p.ppid), hops++) out.add(p.pid);
	return out;
}

function simulators(sid) {
	let mine = [];
	try {
		mine = readdirSync(SIM_USERS).filter((u) => {
			try { return readFileSync(join(SIM_USERS, u), "utf8").trim() === sid; } catch { return false; }
		});
	} catch {}
	if (mine.length === 0) return [];
	const env = { ...process.env, DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer" };
	let booted = {};
	try { booted = JSON.parse(run("/usr/bin/xcrun", ["simctl", "list", "devices", "booted", "-j"], { env })).devices ?? {}; } catch {}
	const found = [];
	for (const d of Object.values(booted).flat()) {
		if (mine.includes(d.udid)) found.push({ id: `sim:${d.udid}`, kind: "iOS simulator", what: `${d.name} (${d.udid})`, stop: `xcrun simctl shutdown ${d.udid}` });
	}
	return found;
}

// macOS hides the environment of its own binaries (tail, sleep, zsh, ssh), so also count
// everything below this session's Claude process and below a process the environment proved ours.
// A system binary detached from both (`nohup tail -f … &`) stays invisible.
export function withDescendants(procs, owned, roots) {
	const out = new Set(owned);
	const queue = [...owned, ...roots];
	while (queue.length) {
		const pid = queue.shift();
		for (const c of procs) if (c.ppid === pid && !out.has(c.pid)) { out.add(c.pid); queue.push(c.pid); }
	}
	return out;
}

function claudePid(procs, selfPid) {
	if (Number(process.env.CLAUDE_PID) > 1) return Number(process.env.CLAUDE_PID);
	const byPid = new Map(procs.map((p) => [p.pid, p]));
	for (let p = byPid.get(selfPid), hops = 0; p && hops < 64; p = byPid.get(p.ppid), hops++) {
		if (/^(\S*\/)?claude(\s|$)/.test(p.cmd)) return p.pid;
	}
	return null;
}

export function scan(sid, selfPid = process.pid, { fromHook = true } = {}) {
	const procs = parsePs(run("/bin/ps", ["-axww", "-o", "pid=,ppid=,command="]));
	const env = sessionPids(run("/bin/ps", ["-axwwE", "-o", "pid=,command="]), sid);
	const root = fromHook ? claudePid(procs, selfPid) : null;
	const owned = withDescendants(procs, env, root ? [root] : []);
	return [...leftovers(procs, owned, ancestors(procs, selfPid)), ...simulators(sid)];
}

export function message(items) {
	const lines = items.map((i) => `- ${i.kind}: ${i.what}\n  stop it: \`${i.stop}\``);
	return `This session still runs ${items.length} thing(s) that will not stop on their own:\n${lines.join("\n")}\n` +
		"Stop each one you no longer need (CLAUDE.md: clean up what you started before you finish; a test's server, simulator, tunnel or watcher counts). " +
		"If one must stay because Liam is using it right now (a server or simulator you showed him), leave it and say in your reply what stays and why. " +
		"Also remove throwaway test data you created that is no longer needed. You are told about each item once.";
}

function main() {
	const args = process.argv.slice(2);
	if (args[0] === "--list") {
		const sid = args[1] || process.env.CLAUDE_CODE_SESSION_ID;
		for (const i of scan(sid, process.pid, { fromHook: sid === process.env.CLAUDE_CODE_SESSION_ID })) console.log(`${i.kind}\t${i.stop}\t${i.what}`);
		return;
	}
	const entry = process.env.CLAUDE_CODE_ENTRYPOINT ?? "";
	if (entry === "" || entry.startsWith("sdk")) return;
	let input = {};
	try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
	const sid = input.session_id || process.env.CLAUDE_CODE_SESSION_ID;
	if (!sid) return;

	const items = scan(sid);
	const stateFile = join(STATE_DIR, `${sid}.json`);
	let told = [];
	try { told = JSON.parse(readFileSync(stateFile, "utf8")); } catch {}
	const fresh = items.filter((i) => !told.includes(i.id));
	if (fresh.length === 0) return;
	try {
		mkdirSync(STATE_DIR, { recursive: true });
		writeFileSync(stateFile, JSON.stringify([...told, ...fresh.map((i) => i.id)].slice(-200)));
	} catch {}
	process.stdout.write(JSON.stringify({ decision: "block", reason: message(fresh) }));
}

// Run through the ~/.claude/hooks symlink, so compare real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try { main(); } catch {}
}
