#!/usr/bin/env node
//
// launch-gate.mjs — refuse to start another Next dev server or Android
// emulator when this Mac already runs its share. Used by heavy-gate.sh (the
// Bash PreToolUse hook). Prints the refusal reason, or nothing to allow.
//
//   `next dev`,     refused at AGENT_MAX_DEV_SERVERS (4) running servers.
//   `npm run dev`   Each grows to 2-6 GB once pages compile.
//   `emulator -avd` refused at AGENT_MAX_EMULATORS (1) running emulators.
//                   Each holds 6-10 GB, plus 5-13 GB of Gradle and Kotlin
//                   daemons for the builds that go with it.
//
// Anything the gate cannot see (XcodeBuildMCP, a wrapper script that starts
// `next dev` itself) is cleaned up by ~/.claude/bin/agent-reaper.mjs instead.
//
// Usage: launch-gate.mjs <command>
import { readFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { devServers, processes } from "../bin/agent-reaper.mjs";
import { segments, words } from "./heavy-classify.mjs";

const MAX_DEV = Number(process.env.AGENT_MAX_DEV_SERVERS || 4);
const MAX_EMU = Number(process.env.AGENT_MAX_EMULATORS || 1);
const PREFIX = new Set(["time", "env", "cross-env", "nice", "nohup", "command", "exec", "caffeinate"]);
// session-board/scripts/sim-owner.mjs records which session last used each emulator here.
const SIM_USERS = join(homedir(), ".cache/agent-sims");

function launches(cmd) {
	const found = { dev: false, emulator: false };
	for (const s of segments(cmd)) {
		let w = words(cmd, s.start, s.end).map((x) => x.text);
		while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || PREFIX.has(w[0]))) w = w.slice(1);
		const base = w.map((t) => t.split("/").pop());
		if (base.some((t, i) => t === "next" && w[i + 1] === "dev")) found.dev = true;
		// `emulator -avd <name>` or `emulator @<name>` boots one; `-list-avds` and the like do not.
		if (base[0] === "emulator" && w.slice(1).some((t, i, a) => (t === "-avd" && a[i + 1]) || /^@./.test(t))) found.emulator = true;
		if (["npm", "pnpm", "yarn", "bun"].includes(base[0])) {
			const script = ["run", "run-script"].includes(w[1]) ? w[2] : base[0] === "npm" ? null : w[1];
			if (script && /^dev(:|$)/.test(script)) found.dev = true;
		}
	}
	return found;
}

const age = (sec) => (sec >= 5400 ? `${(sec / 3600).toFixed(1)} h` : `${Math.round(sec / 60)} min`);

// Running Android emulators: the qemu process that `emulator` starts.
export function emulators(procs = processes(), usersDir = SIM_USERS) {
	return procs
		.filter((p) => /\/qemu-system-[\w-]+\s.*-avd\s/.test(p.cmd))
		.map((p) => {
			const avd = p.cmd.match(/\s-avd\s+(\S+)/)?.[1];
			const port = Number(p.cmd.match(/\s-port\s+(\d+)/)?.[1] ?? 5554);
			let owner = null;
			try {
				owner = readFileSync(join(usersDir, `android:emulator-${port}`), "utf8").trim() || null;
			} catch {}
			return { pid: p.pid, avd, serial: `emulator-${port}`, ageSec: p.ageSec, memKB: p.rssKB, owner };
		});
}

export function denial(cmd, procs) {
	const want = launches(cmd);
	if (!want.dev && !want.emulator) return null;
	procs ??= processes();
	if (want.emulator) {
		const running = emulators(procs);
		// The hook runs outside the command, so an override written into it is read from its text.
		const limit = Number(cmd.match(/(?:^|[\s;&|(])AGENT_MAX_EMULATORS=(\d+)/)?.[1] ?? MAX_EMU);
		if (running.length >= limit) {
			const list = running.map((e) => `  - ${e.serial} (AVD ${e.avd}), up ${age(e.ageSec)}, last used by session ${e.owner ?? "unknown"}`);
			return [
				`Resource gate: ${running.length} Android emulator(s) already running on this Mac (limit ${limit}). Each holds 6-10 GB, plus the Gradle builds that go with it.`,
				...list,
				"If one is your session's, reuse it: ANDROID_SERIAL=<serial>. Never stop or reinstall on another session's emulator.",
				"Otherwise do the work that needs no device first (./gradlew test, lint, code changes) and try again later. An emulator whose session ended is stopped by the agent reaper within 5 minutes.",
				"If the operator asked for a second emulator now, prefix the command with AGENT_MAX_EMULATORS=2.",
			].join("\n");
		}
	}
	if (!want.dev) return null;
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
