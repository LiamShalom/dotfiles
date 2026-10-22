#!/usr/bin/env node
//
// chrome-devtools-mcp-proxy.mjs — sits between Claude Code and
// chrome-devtools-mcp and makes `new_page` open tabs in the background unless
// a call asks for `background: false`. Upstream defaults to the foreground,
// which pulls Chrome in front of whatever app you are working in.
//
// chrome-devtools-mcp starts on the chat's first call that needs it. Until
// then the proxy answers Claude Code's discovery probe, the handshake and the
// tool list itself, from what the same server command answered before
// (~/.cache/agent-chrome/handshakes), so a chat that never uses the browser
// never runs the server (~160 MB each). Without saved answers for this command
// and protocol version, the server starts at once and its answers are saved for
// the next chat.
//
// When the server is attached to the shared agent Chrome (--browserUrl), each
// chat also gets a window of its own: a browser context this proxy creates as
// the chat starts, over a DevTools connection of its own that it holds for the
// chat's life. The context has no window until its first tab opens. Its id is
// in ~/.cache/agent-chrome/chats/<session id>, under the chat's current id (a
// recompact or /clear changes it while this process runs), so Session Board
// hand-offs and CDP scripts open their tabs in the same window. The shared
// profile's cookies are copied in, and sign-ins made in the window are copied
// back, so the next chat starts signed in too. Sign-ins on the SideShift app,
// its previews and local servers stay in the chat, as do those on the sites a
// chat lists in ~/.cache/agent-chrome/unshared/<session id>. agent-chrome-proxy.mjs
// disposes the context, and so closes the window, when this proxy exits: when
// the chat is archived, stopped or retired.
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
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

const [command, ...args] = process.argv.slice(2);
let child = null; // chrome-devtools-mcp, once a call needs it
const toolListIds = new Set();
const screenshotCalls = new Map(); // id -> request, until its first answer arrives

const browserUrl = args.includes("--browserUrl") ? args[args.indexOf("--browserUrl") + 1] : null;
const chatsDir = `${homedir()}/.cache/agent-chrome/chats`;
const ownCalls = new Map(); // id -> resolve, for calls this proxy makes itself
const ownContexts = new Set(); // the named contexts this chat opened pages in
// A page list line: "7: Title (https://url) [selected] isolatedContext=name". A tab with no title shows its URL alone.
const PAGE_LINE = /^\d+: (.*?)(?: \(([^ ()]*)\))?(?: \[selected\])?(?: isolatedContext=(\S+))?$/;
let queue = null; // calls wait here while the server starts or the proxy opens a tab for the chat

let chat = null; // { send, context } while the chat's window is open
let opening = null;
let lastAttempt = 0;
let recorded = null; // { file, context }: where the chat's window is recorded
let copied = new Map(); // cookie -> the value copied into the chat's window
let shared = new Map(); // cookie -> the value copied back from the chat's window to the shared profile
let hadTab = false; // whether the chat's window had a tab when its sign-ins were last copied back

// Agents sign in to these as test users and as other people, so a sign-in there stays in the chat, as
// one on a server reached by IP address does.
const KEPT_IN_CHAT = ["sideshift.app", "vercel.app", "localhost"];
const unsharedDir = `${homedir()}/.cache/agent-chrome/unshared`;
const unshared = new Set(KEPT_IN_CHAT); // sites whose sign-ins stay in the chat's window
const unsharedFiles = new Set(); // the chat's lists of them, removed when it ends

// What the server answered before, one file per server command; the browser URL does not change it.
const serverKey = JSON.stringify([command, ...args.map((a, i) => (args[i - 1] === "--browserUrl" ? "" : a))]);
const savedFile = `${homedir()}/.cache/agent-chrome/handshakes/${createHash("sha256").update(serverKey).digest("hex").slice(0, 16)}.json`;
// Claude Code probes with server/discover before it initializes, offering a protocol version.
const discoverKey = (params) => String(params?._meta?.["io.modelcontextprotocol/protocolVersion"] ?? JSON.stringify(params ?? null));
let handshake = null; // { saved, params } once the proxy answered the chat's initialize itself
let logLevel = null; // a logging/setLevel the proxy answered before the server started
const learned = {}; // the server's own answers to this chat, to save: { discover, version, initialize, tools }
const learning = new Map(); // id of a chat request the server answers -> what to keep from the answer
let answers = Promise.resolve(); // answers go to Claude Code one at a time, in the order they came

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

function request(method, params) {
	const id = `proxy-${randomUUID()}`;
	const answered = new Promise((resolve) => ownCalls.set(id, resolve));
	child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
	return answered;
}

const callTool = (name, args) => request("tools/call", { name, arguments: args });

function readSaved() {
	try {
		const saved = JSON.parse(readFileSync(savedFile, "utf8"));
		return saved.server === serverKey ? saved : null;
	} catch {
		return null;
	}
}

// Adds to the saved answers. Chats that start together may each write; the last one wins, and a chat
// that finds nothing saved for it starts its server at once.
function save(update) {
	try {
		const saved = readSaved() ?? { server: serverKey, discover: {}, versions: {} };
		update(saved);
		mkdirSync(savedFile.slice(0, savedFile.lastIndexOf("/")), { recursive: true });
		writeFileSync(`${savedFile}.${process.pid}`, JSON.stringify(saved));
		renameSync(`${savedFile}.${process.pid}`, savedFile);
	} catch {
		// the next chat starts its server at once and tries again
	}
}

function saveLearned() {
	const { discover, version, initialize, tools } = learned;
	save((saved) => {
		if (discover) saved.discover[discover.key] = discover.answer;
		if (initialize && tools) saved.versions[version] = { initialize, tools };
	});
}

// Notes what to keep from the server's answer to a chat request it is about to get.
function learnFrom(msg) {
	if (msg.method === "server/discover") {
		const key = discoverKey(msg.params);
		learning.set(msg.id, (m) => (learned.discover = { key, answer: m.error ? { error: m.error } : { result: m.result } }));
	}
	if (msg.method === "initialize") learning.set(msg.id, (m) => m.result && Object.assign(learned, { version: msg.params?.protocolVersion, initialize: m.result }));
	if (msg.method === "tools/list" && !msg.params?.cursor) {
		learning.set(msg.id, (m) => {
			if (!m.result || m.result.nextCursor) return;
			learned.tools = structuredClone(m.result);
			saveLearned();
		});
	}
}

function start() {
	child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
	eachLine(child.stdout, (line) => {
		answers = answers.then(() => answer(line)).catch(() => process.stdout.write(line + "\n"));
	});
	child.on("exit", (code, signal) => finish(code ?? (signal ? 1 : 0)));
}

// Copies the chat's last sign-ins back before the proxy exits and its window closes.
let finishing = null;
function finish(code) {
	finishing ??= Promise.race([chat && shareSignIns(true), new Promise((resolve) => setTimeout(resolve, 2000))])
		.catch(() => undefined)
		.finally(() => process.exit(code));
}

// Starts the server for a chat whose handshake the proxy answered: the server gets the chat's own
// initialize, then any log level the chat asked for. Its tool list is checked against the one the chat
// got, and the chat is told to read it again if it differs.
async function startLate() {
	start();
	const { saved, params } = handshake;
	const init = await request("initialize", params);
	child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
	if (logLevel) await request("logging/setLevel", logLevel);
	const tools = await request("tools/list", {});
	if (!init.result || !tools.result || tools.result.nextCursor) return;
	if (JSON.stringify(tools.result) === JSON.stringify(saved.tools)) return;
	save((s) => (s.versions[params?.protocolVersion] = { initialize: init.result, tools: tools.result }));
	process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }) + "\n");
}

// outcome: { result } or { error }
function reply(id, outcome) {
	const line = JSON.stringify({ jsonrpc: "2.0", id, ...outcome });
	answers = answers.then(() => answer(line));
}

// Answers what the chat asks before it needs the server. Anything else starts it.
function answerLocally(msg) {
	if (msg.method === "server/discover") {
		const saved = readSaved()?.discover?.[discoverKey(msg.params)];
		if (!saved) return false;
		reply(msg.id, saved);
		return true;
	}
	if (msg.method === "initialize") {
		const saved = readSaved()?.versions?.[msg.params?.protocolVersion];
		if (!saved) return false;
		handshake = { saved, params: msg.params };
		reply(msg.id, { result: saved.initialize });
		return true;
	}
	if (!handshake) return false;
	if (msg.method === "tools/list" && !msg.params?.cursor) {
		toolListIds.add(msg.id);
		reply(msg.id, { result: handshake.saved.tools });
		return true;
	}
	if (msg.method === "ping") {
		reply(msg.id, { result: {} });
		return true;
	}
	if (msg.method === "logging/setLevel") {
		logLevel = msg.params;
		reply(msg.id, { result: {} });
		return true;
	}
	// A notification (initialized, cancelled, roots changed) has nothing to tell a server that is not running.
	return msg.id === undefined && typeof msg.method === "string";
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
				shared = new Map();
				hadTab = false;
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
const asParam = ({ size, session, expires, ...c }) => (session ? c : { ...c, expires });

// Sets cookies in a browser context, or in the shared profile when browserContextId is undefined.
async function setCookies(send, browserContextId, cookies) {
	await send("Storage.setCookies", { browserContextId, cookies }).catch(() =>
		// One cookie Chrome will not take back fails the whole batch.
		Promise.all(cookies.map((c) => send("Storage.setCookies", { browserContextId, cookies: [c] }).catch(() => undefined))),
	);
}

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
		.map(asParam);
	if (!params.length) return;
	await setCookies(send, browserContextId, params);
	for (const c of params) copied.set(cookieKey(c), c.value);
}

// Sites the chat keeps its sign-ins to, for a sign-in with another account: listed one per line in
// ~/.cache/agent-chrome/unshared/<session id>. A site stays listed for the rest of the chat, under any id.
function readUnshared() {
	const id = sessionId();
	if (!id || !/^[\w-]+$/.test(id)) return;
	const file = `${unsharedDir}/${id}`;
	const text = readText(file);
	if (text === null) return;
	unsharedFiles.add(file);
	for (const site of text.split(/\s+/)) if (site) unshared.add(site.toLowerCase().replace(/^\./, ""));
}

const keptInChat = (domain) => {
	const host = domain.replace(/^\./, "");
	if (/^[\d.]+$/.test(host) || host.includes(":")) return true; // an IPv4 or IPv6 address
	return [...unshared].some((site) => host === site || host.endsWith(`.${site}`));
};

// Copies sign-ins made in the chat's window back to the shared profile, so the next chat starts signed
// in too: every cookie the window set or changed itself, outside the sites kept in the chat. A cookie
// the window deleted, as on a sign-out, stays in the shared profile.
async function shareSignIns(always = false) {
	const { send, context } = chat;
	if (!always) {
		const { targetInfos } = await send("Target.getTargets");
		const hasTab = targetInfos.some((t) => t.type === "page" && t.browserContextId === context);
		// A window sets cookies only while it has a tab; one more pass catches what its last tab set.
		if (!hasTab && !hadTab) return;
		hadTab = hasTab;
	}
	readUnshared();
	const { cookies } = await send("Storage.getCookies", { browserContextId: context });
	const params = cookies
		.filter((c) => c.value !== copied.get(cookieKey(c)) && c.value !== shared.get(cookieKey(c)) && !keptInChat(c.domain))
		.map(asParam);
	if (!params.length) return;
	await setCookies(send, undefined, params);
	for (const c of params) shared.set(cookieKey(c), c.value);
}

// Sign-ins made in the shared profile since, for a window with no tab open, so the next tab has them.
// Says whether the window had no tab.
async function topUpCookies() {
	const { send, context } = chat;
	const { targetInfos } = await send("Target.getTargets");
	const empty = !targetInfos.some((t) => t.type === "page" && t.browserContextId === context);
	if (empty) await copyCookies(send, context);
	return empty;
}

// Chrome opens a chat's window 500 px wide, which gives sites their phone layout. The window gets a
// desktop size once, as its first tab opens, before the agent works in it.
async function sizeNewWindow(send, targetId) {
	const { windowId } = await send("Browser.getWindowForTarget", { targetId });
	await send("Browser.setWindowBounds", { windowId, bounds: { width: 1440, height: 987 } });
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
	const empty = await topUpCookies().catch(() => false);
	const token = randomUUID();
	const { targetId } = await send("Target.createTarget", { url: `about:blank#${token}`, browserContextId: context, background: true });
	if (empty) await sizeNewWindow(send, targetId).catch(() => undefined);
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
	learnFrom(msg);
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
	let msg = null;
	try {
		msg = JSON.parse(line);
	} catch {
		// passed on as it came
	}
	if (!child && msg && answerLocally(msg)) return;
	if (!child) {
		if (handshake) queue = startLate().catch(() => undefined);
		else start();
	}
	if (!msg) {
		if (queue) queue = queue.then(() => child.stdin.write(line + "\n"));
		else child.stdin.write(line + "\n");
	} else if (isChatNewPage(msg)) queue = (queue ?? Promise.resolve()).then(() => newChatPage(msg)).catch(() => undefined);
	else if (queue) queue = queue.then(() => forward(msg));
	else forward(msg);
});
process.stdin.on("end", () => {
	if (!child) return finish(0);
	(queue ?? Promise.resolve()).then(() => child.stdin.end());
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
	const learn = msg.method === undefined && learning.get(msg.id);
	if (learn) {
		learning.delete(msg.id);
		learn(msg);
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
				"Omit it to open the page in this chat's own window, which starts signed in to the sites the shared agent Chrome is signed in to. " +
				"A sign-in made in that window is saved to the shared agent Chrome for later chats, except on the SideShift app, its previews and local servers.";
		}
	}
	process.stdout.write(JSON.stringify(msg) + "\n");
}

if (browserUrl) {
	openChatWindow().catch(() => undefined);
	// Follows the chat's session id, opens a new window after the agent Chrome restarted, keeps a
	// window with no tab open signed in, and copies sign-ins made in the window back.
	let lastTopUp = Date.now();
	let lastShare = 0;
	setInterval(() => {
		if (!chat && !opening && Date.now() - lastAttempt >= 30_000) openChatWindow().catch(() => undefined);
		record();
		if (chat && Date.now() - lastTopUp >= 5 * 60_000) {
			lastTopUp = Date.now();
			topUpCookies().catch(() => undefined);
		}
		if (chat && Date.now() - lastShare >= 10_000) {
			lastShare = Date.now();
			shareSignIns().catch(() => undefined);
		}
	}, 3000).unref();
}

process.on("exit", () => {
	unrecord();
	for (const file of unsharedFiles) rmSync(file, { force: true });
});
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => (child ? child.kill(sig) : finish(0)));
