#!/usr/bin/env node
//
// chrome-devtools-mcp-proxy.mjs — sits between Claude Code and
// chrome-devtools-mcp and makes `new_page` open tabs in the background unless
// a call asks for `background: false`. Upstream defaults to the foreground,
// which pulls Chrome in front of whatever app you are working in.
//
// It also rewrites that parameter's description in `tools/list`, so the model
// sees the default it actually gets, and retries `take_screenshot` once when
// Chrome answers "Internal error" — a background tab sometimes fails its first
// capture just after another window opens. Everything else passes through.
//
// Usage:  chrome-devtools-mcp-proxy.mjs <command> [args...]
import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
const toolListIds = new Set();
const screenshotCalls = new Map(); // id -> request, until its first answer arrives

// MCP stdio is newline-delimited JSON-RPC.
function eachLine(stream, onLine) {
	let buf = "";
	stream.setEncoding("utf8");
	stream.on("data", (chunk) => {
		buf += chunk;
		let i;
		while ((i = buf.indexOf("\n")) >= 0) {
			onLine(buf.slice(0, i));
			buf = buf.slice(i + 1);
		}
	});
	stream.on("end", () => buf && onLine(buf));
}

eachLine(process.stdin, (line) => {
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		child.stdin.write(line + "\n");
		return;
	}
	if (msg.method === "tools/list") toolListIds.add(msg.id);
	if (msg.method === "tools/call" && msg.params?.name === "new_page") {
		const a = (msg.params.arguments ??= {});
		if (a.background === undefined) a.background = true;
	}
	if (msg.method === "tools/call" && msg.params?.name === "take_screenshot") screenshotCalls.set(msg.id, msg);
	child.stdin.write(JSON.stringify(msg) + "\n");
});
process.stdin.on("end", () => child.stdin.end());

eachLine(child.stdout, (line) => {
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		process.stdout.write(line + "\n");
		return;
	}
	const shot = screenshotCalls.get(msg.id);
	if (shot) {
		screenshotCalls.delete(msg.id);
		const failed = msg.result?.isError && JSON.stringify(msg.result.content ?? "").includes("Internal error");
		if (failed) {
			setTimeout(() => child.stdin.write(JSON.stringify(shot) + "\n"), 500);
			return;
		}
	}
	if (toolListIds.delete(msg.id)) {
		const bg = msg.result?.tools?.find((t) => t.name === "new_page")?.inputSchema?.properties?.background;
		if (bg) {
			bg.description =
				"Whether to open the page in the background without bringing it to the front. " +
				"Default is true (background). Pass false only when the page must be in front.";
		}
	}
	process.stdout.write(JSON.stringify(msg) + "\n");
});

child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => child.kill(sig));
