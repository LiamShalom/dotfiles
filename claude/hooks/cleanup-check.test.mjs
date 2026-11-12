// node --test ~/dotfiles/claude/hooks/cleanup-check.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { leftovers, message, sessionPids, withDescendants } from "./cleanup-check.mjs";

const SID = "8483995b-5bbf-461c-bcb1-547242a21cec";
const wrap = (c) => `/bin/zsh -c source /Users/x/.claude/shell-snapshots/snapshot-zsh-1.sh 2>/dev/null || true && eval '${c}' < /dev/null && pwd -P >| /tmp/claude-1-cwd`;
const p = (pid, ppid, cmd) => ({ pid, ppid, cmd });
const kinds = (procs, owned = procs.map((x) => x.pid)) => leftovers(procs, new Set(owned)).map((i) => i.kind);

test("session ownership comes from the inherited environment", () => {
	const env = [`  10 node next dev PATH=/bin CLAUDE_CODE_SESSION_ID=${SID} HOME=/u`, "  11 node next dev CLAUDE_CODE_SESSION_ID=someone-else", "  12 vim"].join("\n");
	assert.deepEqual([...sessionPids(env, SID)], [10]);
});

test("leftovers that never stop on their own are found", () => {
	for (const [cmd, kind] of [
		["node /repo/node_modules/next/dist/bin/next dev -p 3005", "dev server"],
		["npm run dev", "dev server"],
		["cloud-sql-proxy --auto-iam-authn --port 5434 proj:reg:db", "tunnel/proxy"],
		["stripe listen --forward-to localhost:3000/api/stripe", "tunnel/proxy"],
		["tail -f /tmp/dev.log", "watcher"],
		["npx vitest --watch", "watcher"],
		["while true; do curl -s localhost:3000; sleep 5; done", "infinite loop"],
		["/opt/homebrew/share/android-commandlinetools/emulator/qemu/darwin-aarch64/qemu-system-aarch64 -avd x -port 5588", "Android emulator"],
		["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9333 --user-data-dir=/tmp/x", "browser"],
	]) assert.deepEqual(kinds([p(1, 0, cmd)]), [kind], cmd);
});

test("work that finishes by itself, and the harness's own processes, are left alone", () => {
	for (const cmd of [
		"gh pr checks 9816 --watch --interval 60",
		"gh run watch 123",
		"until gh pr checks 9816; do sleep 30; done",
		"npx vitest run lib/foo.test.ts",
		"next build",
		"node /Users/x/.claude/bin/chrome-devtools-mcp-proxy.mjs",
		"npx -y @modelcontextprotocol/server-postgres",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222",
	]) assert.deepEqual(kinds([p(1, 0, cmd)]), [], cmd);
});

test("another session's server is not ours", () => {
	assert.deepEqual(kinds([p(1, 0, "npm run dev")], []), []);
});

test("a background server is reported once, at the Bash-tool shell, with its whole tree to kill", () => {
	const procs = [p(100, 1, wrap("npm run dev -- -p 3007")), p(101, 100, "npm run dev -- -p 3007"), p(102, 101, "node next dev -p 3007"), p(103, 102, "next-server (v16)")];
	const found = leftovers(procs, new Set([100, 101, 102, 103]));
	assert.equal(found.length, 1);
	assert.equal(found[0].what, "npm run dev -- -p 3007");
	assert.equal(found[0].stop, "kill 103 102 101 100");
});

test("system binaries with a hidden environment are ours through the process tree", () => {
	const procs = [p(500, 1, "claude bg-spare"), p(501, 500, wrap("while true; do sleep 5; done")), p(502, 501, "sleep 5"), p(600, 1, "node dev.js"), p(601, 600, "tail -f /tmp/x"), p(700, 1, "tail -f /tmp/other")];
	const owned = withDescendants(procs, new Set([600]), [500]);
	assert.deepEqual([...owned].sort(), [501, 502, 600, 601]);
	assert.deepEqual(leftovers(procs, owned).map((i) => i.kind).sort(), ["infinite loop", "watcher"]);
});

test("review findings 11-11: tail with a count, and waits or tools that only look alike", () => {
	assert.deepEqual(kinds([p(1, 0, "tail -n 0 -f /tmp/dev.log")]), ["watcher"]);
	assert.deepEqual(kinds([p(1, 0, "tail -n 50 -F x")]), ["watcher"]);
	assert.deepEqual(kinds([p(1, 0, "ssh -N -L 5432:localhost:5432 bastion")]), ["tunnel/proxy"]);
	for (const cmd of ["npx vitest run --watch=false", "while true; do curl -sf localhost:3000 && break; sleep 2; done", "ssh-add -D", "tail -n 20 /tmp/x"]) {
		assert.deepEqual(kinds([p(1, 0, cmd)]), [], cmd);
	}
});

test("a respawned child is the same leftover, and the kill reaches the parent that respawns it", () => {
	const first = leftovers([p(10, 1, "bash respawn.sh"), p(11, 10, "tail -f /dev/null")], new Set([10, 11]));
	const again = leftovers([p(10, 1, "bash respawn.sh"), p(12, 10, "tail -f /dev/null")], new Set([10, 12]));
	assert.equal(first[0].id, again[0].id);
	assert.equal(first[0].stop, "kill 11 10");
});

test("the hook's own process chain is excluded", () => {
	assert.deepEqual(leftovers([p(5, 1, "tail -f x")], new Set([5]), new Set([5])), []);
});

test("the message names each item and how to stop it", () => {
	const m = message([{ kind: "dev server", what: "npm run dev", stop: "kill 1" }]);
	assert.match(m, /1 thing\(s\)/);
	assert.match(m, /`kill 1`/);
	assert.match(m, /say in your reply what stays and why/);
});
