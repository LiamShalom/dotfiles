#!/usr/bin/env node
//
// launch-gate.mjs — refuse to start another Next dev server
// when this Mac already runs its share. Used by heavy-gate.sh (the Bash
// PreToolUse hook). Prints the refusal reason, or nothing to allow.
//
//   `next dev`,     refused at AGENT_MAX_DEV_SERVERS (4) running servers.
//   `npm run dev`   Each grows to 2-6 GB once pages compile.
//
// Anything the gate cannot see (XcodeBuildMCP, a wrapper script that starts
// `next dev` itself) is cleaned up by ~/.claude/bin/agent-reaper.mjs instead.
//
// Usage: launch-gate.mjs <command>
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { devServers, processes } from "../bin/agent-reaper.mjs";
import { segments, words } from "./heavy-classify.mjs";

const MAX_DEV = Number(process.env.AGENT_MAX_DEV_SERVERS || 4);
const PREFIX = new Set(["time", "env", "cross-env", "nice", "nohup", "command", "exec", "caffeinate"]);

function launches(cmd) {
	const found = { dev: false };
	for (const s of segments(cmd)) {
		let w = words(cmd, s.start, s.end).map((x) => x.text);
		while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || PREFIX.has(w[0]))) w = w.slice(1);
		const base = w.map((t) => t.split("/").pop());
		if (base.some((t, i) => t === "next" && w[i + 1] === "dev")) found.dev = true;
		if (["npm", "pnpm", "yarn", "bun"].includes(base[0])) {
			const script = ["run", "run-script"].includes(w[1]) ? w[2] : base[0] === "npm" ? null : w[1];
			if (script && /^dev(:|$)/.test(script)) found.dev = true;
		}
	}
	return found;
}

const age = (sec) => (sec >= 5400 ? `${(sec / 3600).toFixed(1)} h` : `${Math.round(sec / 60)} min`);

export function denial(cmd) {
	const want = launches(cmd);
	if (!want.dev) return null;
	const procs = processes();
	if (want.dev) {
		const servers = devServers(procs);
		if (servers.length >= MAX_DEV) {
			const list = servers.map((s) => `  - :${s.ports.join(",:") || "?"} in ${s.cwd}, up ${age(s.ageSec)}, ${(s.memKB / 1048576).toFixed(1)} GB, ${s.clients ? `${s.clients} client(s) connected` : "no client connected"}`);
			return [
				`Resource gate: ${servers.length} Next dev servers are already running on this Mac (limit ${MAX_DEV}). Each one grows to 2-6 GB.`,
				...list,
				"Reuse the server for your worktree if it is listed, or stop one that you started. Never stop another session's server. Agent servers with no client connected stop on their own after 2 hours.",
			].join("\n");
		}
	}
	return null;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const reason = denial(process.argv[2] ?? "");
	if (reason) process.stdout.write(reason);
}
