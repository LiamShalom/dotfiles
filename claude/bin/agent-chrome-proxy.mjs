#!/usr/bin/env node
//
// agent-chrome-proxy.mjs — the DevTools endpoint every agent connects to. It
// sits in front of the agents' browser: Session Board while it runs (see
// below), the shared agent Chrome (agent-chrome.sh) otherwise. It stops
// agents pulling the browser in front of whatever app you are working in:
//
//   - Target.createTarget always opens in the background. Puppeteer,
//     Playwright and raw CDP scripts omit `background`, and Chrome then
//     activates itself for the new tab or window. /json/new is answered the
//     same way.
//   - Page.bringToFront and Target.activateTarget are answered as if they
//     succeeded but never reach Chrome.
//   - A browser context closes, with its window, when the connection that
//     created it closes. Nothing else closes them: chrome-devtools-mcp leaves
//     its contexts open when its chat ends.
//   - A client that auto-attaches to pages browser-wide, as Playwright's
//     connectOverCDP does, is attached only to the pages it opened: those in
//     the browser contexts it created, the tabs it created, and their popups.
//     Playwright takes every page it is attached to as its own and dismisses
//     any dialog it has no handler for, so while a Playwright script ran, a
//     confirm() in Session Board's pane or in another chat's window closed by
//     itself. The proxy lets the other pages go at once, so none of them waits
//     on that client. Clients that attach to pages themselves
//     (chrome-devtools-mcp, Session Board, CDP scripts) still reach every tab.
//
//   - Session Board learns which chat each connection comes from (`?chat=` on
//     the connection it makes there): the Claude Code process the client runs
//     under. It shows a chat's tools only the pages of the browser contexts
//     that chat made, its window and its isolated contexts, and the tabs it
//     opened elsewhere. Without that, every chat's chrome-devtools-mcp attached
//     to every page in the board and received all of their events.
//
// Everything else passes through unchanged. The JSON endpoints are rewritten
// to name this port, so clients that read webSocketDebuggerUrl stay on the
// proxy.
//
// While Session Board runs, it is the agents' browser: it serves the same
// DevTools endpoints on a port of its own and names that port in
// ~/.cache/agent-chrome/board.json (AGENT_CHROME_BOARD_FILE overrides the
// path). Each new request and connection goes to:
//
//   - Session Board, when the file names a live process whose port answers
//     /json/version within a second. One look serves every request for a
//     second, so a burst of requests costs one probe.
//   - Session Board after a wait, when it is starting (its process is alive
//     but its port does not answer yet) or quit less than 90 s ago (an install
//     restarts it within seconds). The proxy looks again every 250 ms for up
//     to 45 s, then uses the headless Chrome. It does not wait again for a
//     board.json it already waited on, so a board that never answers costs
//     one wait, not one per request.
//   - The headless Chrome on <chrome-port> otherwise.
//
// The rules above hold for both. While Session Board is up, the proxy closes
// the connections it sent to the headless Chrome, so their clients reconnect
// and land on the board. It looks every 2 s, and when it sends a new
// connection to the board.
//
// To run a new version without closing anyone's window: `kill -USR2 <pid>`
// makes this proxy stop taking connections and keep serving the ones it has
// (a chat's window lives as long as the connection that created it), and
// agent-chrome.sh then starts the new version on the port.
//
// Usage:  agent-chrome-proxy.mjs <listen-port> <chrome-port>
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const require = createRequire(`${homedir()}/.cache/agent-chrome/cdp-proxy/`);
const { WebSocket, WebSocketServer } = require("ws");

const [LISTEN, CHROME] = process.argv.slice(2).map(Number);
const HOST = "127.0.0.1";
const MAX_PAYLOAD = 512 * 1024 * 1024; // screenshots and heap snapshots are large
const SWALLOWED = new Set(["Page.bringToFront", "Target.activateTarget"]);
// Ids of the proxy's own commands, far above any a client reaches.
const OWN_IDS = 2_000_000_000;
const BOARD_FILE = process.env.AGENT_CHROME_BOARD_FILE || `${homedir()}/.cache/agent-chrome/board.json`;

const toProxy = (text, port) => text.replace(new RegExp(`(127\\.0\\.0\\.1|localhost):${port}\\b`, "g"), `$1:${LISTEN}`);

const log = (line) => process.stderr.write(`${new Date().toISOString()} ${line}\n`);

function chromeHttp(port, path, method = "GET") {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: HOST, port, path, method }, (res) => {
			const chunks = [];
			res.on("data", (c) => chunks.push(c));
			res.on("end", () => resolve({ res, body: Buffer.concat(chunks) }));
		});
		req.on("error", reject);
		req.end();
	});
}

// /json/new opens a foreground tab in Chrome, so open it over CDP instead.
async function openBackgroundTab(port, url) {
	const version = JSON.parse((await chromeHttp(port, "/json/version")).body);
	const ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false });
	await new Promise((resolve, reject) => ws.once("open", resolve).once("error", reject));
	const targetId = await new Promise((resolve, reject) => {
		ws.on("message", (data) => {
			const msg = JSON.parse(data);
			if (msg.id !== 1) return;
			msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result.targetId);
		});
		ws.send(JSON.stringify({ id: 1, method: "Target.createTarget", params: { url, background: true } }));
	});
	ws.close();
	const list = JSON.parse((await chromeHttp(port, "/json/list")).body);
	return list.find((t) => t.id === targetId) ?? { id: targetId };
}

// The chat a connection comes from (see the top): the nearest Claude Code process among the client's
// ancestors, by the ~/.claude/sessions/<pid>.json each one keeps, named by its pid and start so a
// reused pid names no other chat. Null for a tool no chat runs, a client not found in 3 s, or a
// socket more than one process holds.
const SESSIONS = `${homedir()}/.claude/sessions`;
function chatOf(socket) {
	const port = socket.remotePort;
	return new Promise((resolve) => {
		execFile("/usr/sbin/lsof", ["-nP", `-iTCP@127.0.0.1:${port}`, "-sTCP:ESTABLISHED", "-Fpn"], { timeout: 3000 }, (_, sockets) => {
			// The client: whoever holds this very connection's other end.
			const holders = new Set();
			let pid = 0;
			for (const line of String(sockets ?? "").split("\n")) {
				if (line.startsWith("p")) pid = Number(line.slice(1));
				else if (line === `n127.0.0.1:${port}->127.0.0.1:${LISTEN}`) holders.add(pid);
			}
			if (holders.size !== 1) return resolve(null);
			const [client] = holders;
			execFile("/bin/ps", ["-axo", "pid=,ppid="], { timeout: 3000, maxBuffer: 16 * 1024 * 1024 }, (_, table) => {
				const parent = new Map();
				for (const line of String(table ?? "").split("\n")) {
					const [pid, ppid] = line.trim().split(/\s+/).map(Number);
					if (pid) parent.set(pid, ppid);
				}
				for (let pid = client, hops = 0; pid > 1 && hops < 64; pid = parent.get(pid), hops++) {
					try {
						const { startedAt } = JSON.parse(readFileSync(`${SESSIONS}/${pid}.json`, "utf8"));
						return resolve(`${pid}.${startedAt}`);
					} catch {}
				}
				resolve(null);
			});
		});
	});
}

// The path of a connection to Session Board, naming the client's chat. A client cannot name one itself.
// Throws for a path that is no URL path.
function withChat(path, chat) {
	const url = new URL(`http://${HOST}${path}`);
	url.searchParams.delete("chat");
	if (chat) url.searchParams.set("chat", chat);
	return url.pathname + url.search;
}

// Keeps a client that auto-attaches to pages browser-wide to the pages it opened (see the top).
// Chrome announces each auto-attached page with Target.attachedToTarget; the proxy passes on those
// of the client's pages and detaches the client from the others, telling it nothing.
function ownPagesOnly(toClient, toChrome) {
	const contexts = new Set(); // browser contexts the client created
	const targets = new Set(); // tabs it created, and the popups they opened
	const asked = new Map(); // "<session>:<id>" -> { method, targetId }, until Chrome answers what the client opened
	// Pages the client attaches to itself (Target.attachToTarget), which Chrome announces with the same event,
	// usually before it answers the call.
	const attaching = new Map(); // targetId -> calls Chrome has not answered
	const announced = new Set(); // their sessions Chrome announced before answering
	const attached = new Set(); // their sessions Chrome answered with before announcing them
	const mine = new Set(); // ids of the proxy's own commands Chrome has not answered: never the client's to see
	const letGo = new Set(); // sessions of pages the client was detached from
	const held = []; // messages to the client, in order, behind an attach not judged yet
	let autoAttach = false;
	let nextId = OWN_IDS;
	let timer = null;

	const judge = ({ targetInfo: t, sessionId }) => {
		if (attaching.has(t.targetId)) {
			announced.add(sessionId);
			return "asked";
		}
		if (attached.delete(sessionId)) return "asked";
		if (contexts.has(t.browserContextId) || targets.has(t.targetId) || (t.openerId && targets.has(t.openerId))) {
			targets.add(t.targetId);
			return "own";
		}
		// Chrome can announce the client's new tab before it answers the Target.createTarget that opened it.
		for (const { method } of asked.values()) if (method === "Target.createTarget") return "wait";
		return "other";
	};

	const send = (msg) => {
		msg.id = nextId++;
		mine.add(msg.id);
		toChrome(msg);
	};

	const detach = ({ sessionId, waitingForDebugger }) => {
		letGo.add(sessionId);
		if (waitingForDebugger) send({ method: "Runtime.runIfWaitingForDebugger", sessionId });
		send({ method: "Target.detachFromTarget", params: { sessionId } });
	};

	const flush = () => {
		clearTimeout(timer);
		while (held.length) {
			const next = held[0];
			if (next.attach) {
				const verdict = judge(next.attach);
				if (verdict === "wait") {
					// A tab Chrome does not answer for in time is taken as the client's: a client
					// missing one of its own pages is worse off than one seeing a page too many.
					next.since ??= Date.now();
					const left = next.since + 2000 - Date.now();
					if (left > 0) {
						timer = setTimeout(flush, left);
						return;
					}
				}
				held.shift();
				if (verdict === "other") detach(next.attach);
				else toClient(next.data, next.isBinary);
				continue;
			}
			held.shift();
			toClient(next.data, next.isBinary);
		}
	};

	return {
		fromClient(msg) {
			if (msg.method === "Target.setAutoAttach" && !msg.sessionId) autoAttach = msg.params?.autoAttach === true;
			if (!["Target.createTarget", "Target.createBrowserContext", "Target.attachToTarget"].includes(msg.method)) return;
			// Only a client that auto-attaches gets announcements judged.
			if (msg.method === "Target.attachToTarget" && !autoAttach) return;
			const targetId = msg.params?.targetId;
			asked.set(`${msg.sessionId ?? ""}:${msg.id}`, { method: msg.method, targetId });
			if (msg.method === "Target.attachToTarget") attaching.set(targetId, (attaching.get(targetId) ?? 0) + 1);
		},
		fromChrome(data, isBinary) {
			const watching = asked.size > 0 || mine.size > 0 || letGo.size > 0;
			if (!autoAttach && !watching && !held.length) return toClient(data, isBinary);
			// The messages that matter here are small; frames and screenshots pass unread.
			let msg = null;
			if (!isBinary && data.length < 65536 && (watching || data.includes('"Target.attachedToTarget"'))) {
				try {
					msg = JSON.parse(data);
				} catch {}
			}
			let attach = null;
			if (msg) {
				if (mine.delete(msg.id)) return;
				if (msg.sessionId && letGo.has(msg.sessionId)) return;
				if (msg.method === "Target.detachedFromTarget" && !msg.sessionId && letGo.delete(msg.params?.sessionId)) return;
				const key = `${msg.sessionId ?? ""}:${msg.id}`;
				if (msg.id !== undefined && asked.has(key)) {
					const { method, targetId } = asked.get(key);
					asked.delete(key);
					if (method === "Target.createTarget" && msg.result?.targetId) targets.add(msg.result.targetId);
					if (method === "Target.createBrowserContext" && msg.result?.browserContextId) contexts.add(msg.result.browserContextId);
					if (method === "Target.attachToTarget") {
						const left = attaching.get(targetId) - 1;
						left > 0 ? attaching.set(targetId, left) : attaching.delete(targetId);
						if (msg.result?.sessionId && !announced.delete(msg.result.sessionId)) attached.add(msg.result.sessionId);
					}
				}
				if (autoAttach && !msg.sessionId && msg.method === "Target.attachedToTarget" && msg.params?.targetInfo?.type === "page") attach = msg.params;
			}
			if (!attach && !held.length) return toClient(data, isBinary);
			held.push({ data, isBinary, attach });
			flush();
		},
		close() {
			clearTimeout(timer);
		},
	};
}

// Chrome refuses DevTools requests from web pages by their Host and Origin headers, but it sees
// only this proxy's, so the proxy checks them itself. Without this, a page using DNS rebinding
// could read the browser's address and drive the agent Chrome with every login in it.
const fromLocalTool = (req) =>
	[`127.0.0.1:${LISTEN}`, `localhost:${LISTEN}`].includes(req.headers.host) && req.headers.origin === undefined;

// Whether Session Board's port answers /json/version within a second. The probe uses a connection
// of its own, so its timeout cannot cut a kept-alive connection that a later request reuses.
const answers = (port) =>
	new Promise((resolve) => {
		const options = { host: HOST, port, path: "/json/version", agent: false, signal: AbortSignal.timeout(1000) };
		http
			.get(options, (res) => {
				res.resume();
				resolve(res.statusCode === 200);
			})
			.on("error", () => resolve(false));
	});

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// What board.json says: Session Board is "up" (on its port), "coming" back, or "gone". A board that
// crashed leaves a dead pid behind, so it is gone at once.
async function readBoard() {
	let text, board;
	try {
		text = await readFile(BOARD_FILE, "utf8");
		board = JSON.parse(text) ?? {};
	} catch {
		return { state: "gone" };
	}
	const { pid, port, quitAt } = board;
	if (Number.isInteger(pid) && pid > 0 && Number.isInteger(port) && alive(pid)) {
		return (await answers(port)) ? { state: "up", port } : { state: "coming", text };
	}
	return Date.now() - quitAt < 90_000 ? { state: "coming", text } : { state: "gone" };
}

// A look at the board serves every request for maxAge ms, and requests that arrive while one is
// in flight share it.
let look = null;
function lookAtBoard(maxAge = 1000) {
	if (look && (look.at === undefined || Date.now() - look.at < maxAge)) return look.promise;
	const current = {};
	current.promise = readBoard().then((board) => {
		current.at = Date.now();
		return board;
	});
	look = current;
	return current.promise;
}

let waiting = null; // the wait for a board coming back, shared by every request that arrives meanwhile
let gaveUpOn = null; // board.json as it read when a wait last ran out
let routed = null; // the backend the last request went to

// The port of the backend for a new request or connection (see the top).
async function backend() {
	const board = await lookAtBoard();
	let port = board.port ?? CHROME;
	if (board.state === "coming" && board.text !== gaveUpOn) {
		waiting ??= waitForBoard().finally(() => (waiting = null));
		port = await waiting;
	}
	if (port !== routed) {
		log(port === CHROME ? `routing to the headless Chrome on port ${CHROME}` : `routing to Session Board on port ${port}`);
	}
	routed = port;
	return port;
}

async function waitForBoard() {
	const until = Date.now() + 45_000;
	let board;
	do {
		await new Promise((resolve) => setTimeout(resolve, 250));
		board = await lookAtBoard(0);
		if (board.state !== "coming") return board.port ?? CHROME;
	} while (Date.now() < until);
	gaveUpOn = board.text;
	log("Session Board did not come back within 45 s");
	return CHROME;
}

// Connections the proxy sent to the headless Chrome.
const onChrome = new Set();

function moveToBoard() {
	if (!onChrome.size) return;
	const count = onChrome.size === 1 ? "1 connection" : `${onChrome.size} connections`;
	log(`closed ${count} to the headless Chrome so their clients reconnect to Session Board`);
	for (const { client, upstream } of onChrome) {
		client.close(1012, "agent-chrome-proxy: moving to Session Board");
		upstream.close();
	}
	onChrome.clear();
}

// Unref'd, so that after SIGUSR2 the process still exits when its last connection closes.
setInterval(async () => {
	if (onChrome.size && (await lookAtBoard()).state === "up") moveToBoard();
}, 2000).unref();

const server = http.createServer(async (req, res) => {
	try {
		const { pathname, search } = new URL(req.url, `http://${HOST}`);
		if (!fromLocalTool(req)) {
			res.writeHead(403, { "content-type": "text/plain" }).end("agent-chrome-proxy: only local tools may connect\n");
			return;
		}
		// agent-chrome.sh asks whether the proxy runs; the answer never waits on a browser.
		if (pathname === "/agent-chrome-proxy") {
			res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
			return;
		}
		let status, headers, body;
		if (pathname === "/json/new" && req.method !== "PUT") {
			res.writeHead(405, { "content-type": "text/plain" }).end("agent-chrome-proxy: /json/new needs PUT, as in Chrome\n");
			return;
		}
		const port = await backend();
		if (pathname === "/json/new") {
			const url = decodeURIComponent(search.slice(1)) || "about:blank";
			status = 200;
			headers = { "content-type": "application/json; charset=UTF-8" };
			body = Buffer.from(JSON.stringify(await openBackgroundTab(port, url), null, 2));
		} else {
			const upstream = await chromeHttp(port, req.url, req.method);
			status = upstream.res.statusCode;
			headers = { ...upstream.res.headers };
			body = upstream.body;
		}
		if (String(headers["content-type"] ?? "").includes("json")) body = Buffer.from(toProxy(body.toString(), port));
		headers["content-length"] = body.length;
		// The body goes out whole, so an upstream's chunked framing does not apply to it. Chrome never
		// chunks, but a Node server does unless it sets the length, and a response with both is refused.
		delete headers["transfer-encoding"];
		headers["x-agent-chrome-proxy"] = "1";
		res.writeHead(status, headers).end(body);
	} catch (err) {
		res.writeHead(502, { "content-type": "text/plain" }).end(`agent-chrome-proxy: ${err.message}\n`);
	}
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: MAX_PAYLOAD });

server.on("upgrade", async (req, socket, head) => {
	if (!fromLocalTool(req)) {
		socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
		return;
	}
	// Nothing listens for the socket's errors until the upgrade completes, and picking a backend can
	// wait up to 45 s for Session Board. An unhandled socket error would end the proxy for everyone.
	socket.on("error", () => socket.destroy());
	const [port, chat] = await Promise.all([backend(), chatOf(socket)]);
	if (socket.destroyed) return;
	// A path that is no URL would throw here, and an error this handler does not catch ends the proxy.
	let upstream;
	try {
		upstream = new WebSocket(`ws://${HOST}:${port}${port === CHROME ? req.url : withChat(req.url, chat)}`, {
			perMessageDeflate: false,
			maxPayload: MAX_PAYLOAD,
		});
	} catch {
		socket.destroy();
		return;
	}
	upstream.once("error", () => socket.destroy());
	upstream.once("open", () => {
		wss.handleUpgrade(req, socket, head, (client) => {
			upstream.removeAllListeners("error");
			upstream.on("error", () => client.terminate());
			client.on("error", () => upstream.terminate());
			const pages = ownPagesOnly(
				(data, isBinary) => client.send(data, { binary: isBinary }),
				(msg) => upstream.send(JSON.stringify(msg)),
			);

			client.on("message", (data, isBinary) => {
				let msg;
				try {
					msg = JSON.parse(data);
				} catch {
					upstream.send(data, { binary: isBinary });
					return;
				}
				if (SWALLOWED.has(msg.method)) {
					const reply = { id: msg.id, result: {} };
					if (msg.sessionId) reply.sessionId = msg.sessionId;
					client.send(JSON.stringify(reply));
					return;
				}
				if (msg.method === "Target.createTarget") {
					msg.params = { ...msg.params, background: true };
				}
				if (msg.method === "Target.createBrowserContext") {
					msg.params = { ...msg.params, disposeOnDetach: true };
				}
				pages.fromClient(msg);
				upstream.send(JSON.stringify(msg));
			});
			upstream.on("message", (data, isBinary) => pages.fromChrome(data, isBinary));

			client.on("close", () => {
				pages.close();
				upstream.close();
			});
			upstream.on("close", () => client.close());

			if (port === CHROME) {
				const connection = { client, upstream };
				onChrome.add(connection);
				client.on("close", () => onChrome.delete(connection));
			} else {
				moveToBoard();
			}
		});
	});
});

// See "To run a new version" at the top.
process.on("SIGUSR2", () => server.close());

server.listen(LISTEN, HOST);
