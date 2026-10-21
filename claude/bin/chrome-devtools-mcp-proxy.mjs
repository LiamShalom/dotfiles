#!/usr/bin/env node
//
// chrome-devtools-mcp-proxy.mjs — sits between Claude Code and
// chrome-devtools-mcp and makes `new_page` open tabs in the background unless
// a call asks for `background: false`. Upstream defaults to the foreground,
// which pulls Chrome in front of whatever app you are working in.
//
// When the server is attached to the shared agent Chrome (--browserUrl), each
// chat also gets a window of its own: a browser context this proxy creates as
// the chat starts, over a DevTools connection of its own that it holds for the
// chat's life. The context has no window until its first tab opens. Its id is
// in ~/.cache/agent-chrome/chats/<session id>, under the chat's current id (a
// recompact or /clear changes it while this process runs), so Session Board
// hand-offs and CDP scripts open their tabs in the same window. The shared
// profile's cookies are copied in. agent-chrome-proxy.mjs disposes the
// context, and so closes the window, when this proxy exits: when the chat is
// archived, stopped or retired.
//
// A `new_page` without an `isolatedContext` opens in that window: the proxy
// opens the tab, has chrome-devtools-mcp select it, and passes the call on as
// a navigation of it. Other chats' windows stay out of this chat's page lists.
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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
const toolListIds = new Set();
const screenshotCalls = new Map(); // id -> request, until its first answer arrives

const browserUrl = args.includes("--browserUrl") ? args[args.indexOf("--browserUrl") + 1] : null;
const chatsDir = `${homedir()}/.cache/agent-chrome/chats`;
const ownCalls = new Map(); // id -> resolve, for calls this proxy makes itself
const ownContexts = new Set(); // the named contexts this chat opened pages in
// A page list line: "7: Title (https://url) [selected] isolatedContext=name". A tab with no title shows its URL alone.
const PAGE_LINE = /^\d+: (.*?)(?: \(([^ ()]*)\))?(?: \[selected\])?(?: isolatedContext=(\S+))?$/;
let queue = null; // calls wait here while the proxy opens a tab for the chat

let chat = null; // { send, context } while the chat's window is open
let opening = null;
let lastAttempt = 0;
let recorded = null; // { file, context }: where the chat's window is recorded
let copied = new Map(); // cookie -> the value copied into the chat's window

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

async function connect(onClose) {
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
	ws.onclose = () => {
		for (const p of pending.values()) p.reject(new Error("the agent Chrome closed the connection"));
		pending.clear();
		onClose();
	};
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			pending.set(++next, { resolve, reject });
			ws.send(JSON.stringify({ id: next, method, params }));
		});
	return { send, close: () => ws.close() };
}

// Opens the chat's window: a browser context, with no tab yet, signed in to what the shared profile is signed in to.
function openChatWindow() {
	lastAttempt = Date.now();
	let opened = null;
	opening ??= connect(() => {
		if (chat !== opened) return;
		chat = null;
		record();
	})
		.then(async ({ send, close }) => {
			try {
				const { browserContextId } = await send("Target.createBrowserContext");
				copied = new Map();
				await copyCookies(send, browserContextId).catch(() => undefined);
				chat = opened = { send, context: browserContextId };
				record();
				return chat;
			} catch (err) {
				close();
				throw err;
			}
		})
		.finally(() => (opening = null));
	return opening;
}

const chatWindow = () => (chat ? Promise.resolve(chat) : openChatWindow());

const cookieKey = (c) => `${c.name}\t${c.domain}\t${c.path}\t${JSON.stringify(c.partitionKey ?? null)}`;

// Copies the shared profile's cookies into the chat's window. A cookie the window changed itself, such
// as a sign-in done there, stays as it is.
async function copyCookies(send, browserContextId) {
	const [{ cookies }, { cookies: own }] = await Promise.all([send("Storage.getCookies"), send("Storage.getCookies", { browserContextId })]);
	const have = new Map(own.map((c) => [cookieKey(c), c.value]));
	const params = cookies
		.filter((c) => {
			const value = have.get(cookieKey(c));
			return value === undefined || (value !== c.value && value === copied.get(cookieKey(c)));
		})
		.map(({ size, session, expires, ...c }) => (session ? c : { ...c, expires }));
	if (!params.length) return;
	await send("Storage.setCookies", { browserContextId, cookies: params }).catch(() =>
		// One cookie Chrome will not take back fails the whole batch.
		Promise.all(params.map((c) => send("Storage.setCookies", { browserContextId, cookies: [c] }).catch(() => undefined))),
	);
	for (const c of params) copied.set(cookieKey(c), c.value);
}

// Sign-ins made in the shared profile since, for a window with no tab open, so the next tab has them.
async function topUpCookies() {
	const { send, context } = chat;
	const { targetInfos } = await send("Target.getTargets");
	if (!targetInfos.some((t) => t.type === "page" && t.browserContextId === context)) await copyCookies(send, context);
}

const readText = (path) => {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
};

// The chat's session id now. Claude Code keeps it in its registry under its pid; a recompact or /clear
// changes it, while this process, and the id in its environment, stay.
function sessionId() {
	try {
		const { sessionId } = JSON.parse(readFileSync(`${homedir()}/.claude/sessions/${process.ppid}.json`, "utf8"));
		if (sessionId) return sessionId;
	} catch {
		// not in the registry (yet): the id this process started with
	}
	return process.env.CLAUDE_CODE_SESSION_ID;
}

// Records the chat's window under the chat's session id, for hand-offs and scripts.
function record() {
	const id = chat && sessionId();
	const file = id && /^[\w-]+$/.test(id) ? `${chatsDir}/${id}` : null;
	if (recorded && (recorded.file !== file || recorded.context !== chat?.context)) unrecord();
	if (!file) return;
	recorded = { file, context: chat.context };
	if (readText(file) === chat.context) return;
	mkdirSync(chatsDir, { recursive: true });
	writeFileSync(file, chat.context);
}

// Removes the record, unless another process wrote its own window there since.
function unrecord() {
	if (recorded && readText(recorded.file) === recorded.context) rmSync(recorded.file, { force: true });
	recorded = null;
}

// Opens a tab in the chat's window, has chrome-devtools-mcp select it, and returns its page id.
async function openChatPage() {
	const { send, context } = await chatWindow();
	await topUpCookies().catch(() => undefined);
	const token = randomUUID();
	await send("Target.createTarget", { url: `about:blank#${token}`, browserContextId: context, background: true });
	for (let i = 0; i < 50; i++) {
		const listed = await callTool("list_pages", {});
		const text = listed.result?.content?.find((c) => c.type === "text")?.text ?? "";
		const pageId = Number(text.split("\n").find((l) => l.includes(token))?.match(/^(\d+):/)?.[1]);
		if (pageId) {
			await callTool("select_page", { pageId });
			return pageId;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("chrome-devtools-mcp did not list the chat's new tab");
}

// A new_page for the chat's window: the tab opens there, and the call becomes its navigation, so the
// answer Claude Code waits for is chrome-devtools-mcp's.
async function newChatPage(msg) {
	const { url, timeout } = msg.params.arguments;
	let pageId;
	try {
		pageId = await openChatPage();
	} catch {
		return forward(msg);
	}
	const navigation = { pageId, type: "url", url, ...(timeout === undefined ? {} : { timeout }) };
	forward({ ...msg, params: { ...msg.params, name: "navigate_page", arguments: navigation } });
}

// Other chats' windows stay out of this chat's page lists. chrome-devtools-mcp names a tab's
// context only when it knew that context, so a tab is checked against Chrome by its URL.
async function withoutOtherChats(text) {
	const lines = text.split("\n");
	if (!chat || !lines.some((l) => PAGE_LINE.test(l))) return text;
	const mine = new Set(); // URLs of tabs in this chat's window
	const shared = new Set(); // URLs of tabs in the default context
	const others = new Set(); // URLs of tabs in other contexts
	const { defaultBrowserContextId } = await chat.send("Target.getBrowserContexts");
	for (const t of (await chat.send("Target.getTargets")).targetInfos) {
		if (t.type !== "page") continue;
		(t.browserContextId === chat.context ? mine : t.browserContextId === defaultBrowserContextId ? shared : others).add(t.url);
	}
	return lines
		.flatMap((l) => {
			const m = l.match(PAGE_LINE);
			if (!m) return [l];
			const [, title, url = title, context] = m;
			if (context && ownContexts.has(context)) return [l];
			// chrome-devtools-mcp gives the chat's window a generated name; the chat knows it as its own.
			if (mine.has(url)) return [l.replace(/ isolatedContext=\S+$/, "")];
			return !context && (shared.has(url) || !others.has(url)) ? [l] : [];
		})
		.join("\n");
}

function forward(msg) {
	if (msg.method === "tools/list") toolListIds.add(msg.id);
	if (msg.method === "tools/call" && msg.params?.name === "new_page") {
		const a = (msg.params.arguments ??= {});
		if (a.background === undefined) a.background = true;
		if (a.isolatedContext !== undefined) ownContexts.add(a.isolatedContext);
	}
	if (msg.method === "tools/call" && msg.params?.name === "take_screenshot") screenshotCalls.set(msg.id, msg);
	child.stdin.write(JSON.stringify(msg) + "\n");
}

const isChatNewPage = (msg) =>
	browserUrl && msg.method === "tools/call" && msg.params?.name === "new_page" && msg.params.arguments?.isolatedContext === undefined && typeof msg.params.arguments?.url === "string";

eachLine(process.stdin, (line) => {
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		child.stdin.write(line + "\n");
		return;
	}
	if (isChatNewPage(msg)) queue = (queue ?? Promise.resolve()).then(() => newChatPage(msg)).catch(() => undefined);
	else if (queue) queue = queue.then(() => forward(msg));
	else forward(msg);
});
process.stdin.on("end", () => (queue ?? Promise.resolve()).then(() => child.stdin.end()));

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
	if (Array.isArray(msg.result?.content)) {
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

if (browserUrl) {
	openChatWindow().catch(() => undefined);
	// Follows the chat's session id, opens a new window after the agent Chrome restarted, and keeps a
	// window with no tab open signed in.
	let lastTopUp = Date.now();
	setInterval(() => {
		if (!chat && !opening && Date.now() - lastAttempt >= 30_000) openChatWindow().catch(() => undefined);
		record();
		if (chat && Date.now() - lastTopUp >= 5 * 60_000) {
			lastTopUp = Date.now();
			topUpCookies().catch(() => undefined);
		}
	}, 3000).unref();
}

process.on("exit", unrecord);
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => child.kill(sig));
