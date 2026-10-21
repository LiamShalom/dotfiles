#!/usr/bin/env node
//
// chrome-devtools-mcp-proxy.mjs — sits between Claude Code and
// chrome-devtools-mcp and makes `new_page` open tabs in the background unless
// a call asks for `background: false`. Upstream defaults to the foreground,
// which pulls Chrome in front of whatever app you are working in.
//
// When the server is attached to the shared agent Chrome (--browserUrl), each
// chat also gets a window of its own. Before the chat's first tool call runs,
// the proxy opens a tab in a browser context named "chat", copies the shared
// profile's cookies into it, and records the context id in
// ~/.cache/agent-chrome/chats/<session id> for Session Board hand-offs and CDP
// scripts. Every `new_page` without an `isolatedContext` then opens in that
// context, which Chrome keeps in one window. agent-chrome-proxy.mjs disposes
// the context, and so closes the window, when this server disconnects.
//
// It also rewrites the descriptions of those parameters in `tools/list`, so
// the model sees the defaults it actually gets, and retries `take_screenshot`
// once when Chrome answers "Internal error" — a background tab sometimes fails
// its first capture just after another window opens. Everything else passes
// through.
//
// Usage:  chrome-devtools-mcp-proxy.mjs <command> [args...]
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
const toolListIds = new Set();
const screenshotCalls = new Map(); // id -> request, until its first answer arrives

const CHAT = "chat";
const browserUrl = args.includes("--browserUrl") ? args[args.indexOf("--browserUrl") + 1] : null;
const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
const chatFile = sessionId ? `${homedir()}/.cache/agent-chrome/chats/${sessionId}` : null;
const ownCalls = new Map(); // id -> resolve, for calls this proxy makes itself
const ownContexts = new Set([CHAT]); // the contexts this chat opened pages in
let chatContextId = null;
// A page list line: "7: Title (https://url) [selected] isolatedContext=name". A tab with no title shows its URL alone.
const PAGE_LINE = /^\d+: (.*?)(?: \(([^ ()]*)\))?(?: \[selected\])?(?: isolatedContext=(\S+))?$/;
let ready = null; // settles once the chat's window is open; calls wait for it

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

function callTool(name, args) {
	const id = `chat-window-${randomUUID()}`;
	const answered = new Promise((resolve) => ownCalls.set(id, resolve));
	child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
	return answered;
}

async function cdp(fn) {
	const { webSocketDebuggerUrl } = await (await fetch(`${browserUrl}/json/version`)).json();
	const ws = new WebSocket(webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.onopen = resolve;
		ws.onerror = () => reject(new Error("could not connect to the agent Chrome"));
	});
	let next = 0;
	const pending = new Map();
	ws.onmessage = (event) => {
		const msg = JSON.parse(event.data);
		const p = pending.get(msg.id);
		pending.delete(msg.id);
		if (msg.error) p?.reject(new Error(msg.error.message));
		else p?.resolve(msg.result);
	};
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			pending.set(++next, { resolve, reject });
			ws.send(JSON.stringify({ id: next, method, params }));
		});
	try {
		return await fn(send);
	} finally {
		ws.close();
	}
}

// Opens the chat's window and signs it in to what the shared profile is signed in to.
async function openChatWindow() {
	const token = randomUUID();
	const opened = await callTool("new_page", { url: `about:blank#${token}`, isolatedContext: CHAT, background: true });
	if (opened.result?.isError) return;
	await cdp(async (send) => {
		const { targetInfos } = await send("Target.getTargets");
		const browserContextId = targetInfos.find((t) => t.url.includes(token))?.browserContextId;
		if (!browserContextId) return;
		const { cookies } = await send("Storage.getCookies");
		const params = cookies.map(({ size, session, expires, ...c }) => (session ? c : { ...c, expires }));
		await send("Storage.setCookies", { browserContextId, cookies: params }).catch(() =>
			// One cookie Chrome will not take back fails the whole batch.
			Promise.all(params.map((c) => send("Storage.setCookies", { browserContextId, cookies: [c] }).catch(() => undefined))),
		);
		chatContextId = browserContextId;
		if (chatFile) {
			mkdirSync(`${homedir()}/.cache/agent-chrome/chats`, { recursive: true });
			writeFileSync(chatFile, browserContextId);
		}
	});
}

// Other chats' windows stay out of this chat's page lists. chrome-devtools-mcp names a tab's
// context only when it saw that context created, so an unnamed tab is checked against Chrome too.
async function withoutOtherChats(text) {
	const lines = text.split("\n");
	if (!lines.some((l) => PAGE_LINE.test(l))) return text;
	const shared = new Set(); // URLs of tabs in the default context
	const others = new Set(); // URLs of tabs in other chats' contexts
	await cdp(async (send) => {
		const { defaultBrowserContextId } = await send("Target.getBrowserContexts");
		for (const t of (await send("Target.getTargets")).targetInfos) {
			if (t.type !== "page" || t.browserContextId === chatContextId) continue;
			(t.browserContextId === defaultBrowserContextId ? shared : others).add(t.url);
		}
	});
	return lines
		.filter((l) => {
			const m = l.match(PAGE_LINE);
			if (!m) return true;
			const [, title, url = title, context] = m;
			return context ? ownContexts.has(context) : shared.has(url) || !others.has(url);
		})
		.join("\n");
}

function forward(msg) {
	if (msg.method === "tools/list") toolListIds.add(msg.id);
	if (msg.method === "tools/call" && msg.params?.name === "new_page") {
		const a = (msg.params.arguments ??= {});
		if (a.background === undefined) a.background = true;
		if (browserUrl && a.isolatedContext === undefined) a.isolatedContext = CHAT;
		ownContexts.add(a.isolatedContext);
	}
	if (msg.method === "tools/call" && msg.params?.name === "take_screenshot") screenshotCalls.set(msg.id, msg);
	child.stdin.write(JSON.stringify(msg) + "\n");
}

eachLine(process.stdin, (line) => {
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		child.stdin.write(line + "\n");
		return;
	}
	// The first call would otherwise act on whichever tab of another chat is selected.
	if (browserUrl && msg.method === "tools/call" && !ready) ready = openChatWindow().catch(() => undefined);
	if (ready) ready = ready.then(() => forward(msg));
	else forward(msg);
});
process.stdin.on("end", () => (ready ?? Promise.resolve()).then(() => child.stdin.end()));

// Answers are rewritten one at a time, so they reach Claude Code in the order they came.
let answers = Promise.resolve();
eachLine(child.stdout, (line) => {
	answers = answers.then(() => answer(line)).catch(() => process.stdout.write(line + "\n"));
});

async function answer(line) {
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		process.stdout.write(line + "\n");
		return;
	}
	const own = ownCalls.get(msg.id);
	if (own) {
		ownCalls.delete(msg.id);
		own(msg);
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
	if (chatContextId && Array.isArray(msg.result?.content)) {
		for (const c of msg.result.content) {
			if (c.type === "text" && c.text.includes("## Pages")) c.text = await withoutOtherChats(c.text).catch(() => c.text);
		}
	}
	if (toolListIds.delete(msg.id)) {
		const props = msg.result?.tools?.find((t) => t.name === "new_page")?.inputSchema?.properties;
		if (props?.background) {
			props.background.description =
				"Whether to open the page in the background without bringing it to the front. " +
				"Default is true (background). Pass false only when the page must be in front.";
		}
		if (browserUrl && props?.isolatedContext) {
			props.isolatedContext.description =
				"Name of a separate browser context with its own cookies and storage, for a second login. " +
				"Omit it to open the page in this chat's own window, which starts signed in to the sites the shared agent Chrome is signed in to.";
		}
	}
	process.stdout.write(JSON.stringify(msg) + "\n");
}

process.on("exit", () => chatFile && rmSync(chatFile, { force: true }));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => child.kill(sig));
