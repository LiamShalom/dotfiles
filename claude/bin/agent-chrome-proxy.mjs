#!/usr/bin/env node
//
// agent-chrome-proxy.mjs — the DevTools endpoint every agent connects to. It
// sits in front of the shared agent Chrome (agent-chrome.sh) and stops agents
// pulling Chrome in front of whatever app you are working in:
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
// Everything else passes through unchanged. The JSON endpoints are rewritten
// to name this port, so clients that read webSocketDebuggerUrl stay on the
// proxy.
//
// To run a new version without closing anyone's window: `kill -USR2 <pid>`
// makes this proxy stop taking connections and keep serving the ones it has
// (a chat's window lives as long as the connection that created it), and
// agent-chrome.sh then starts the new version on the port.
//
// Usage:  agent-chrome-proxy.mjs <listen-port> <chrome-port>
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

const toProxy = (text) => text.replace(new RegExp(`(127\\.0\\.0\\.1|localhost):${CHROME}\\b`, "g"), `$1:${LISTEN}`);

function chromeHttp(path, method = "GET") {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: HOST, port: CHROME, path, method }, (res) => {
			const chunks = [];
			res.on("data", (c) => chunks.push(c));
			res.on("end", () => resolve({ res, body: Buffer.concat(chunks) }));
		});
		req.on("error", reject);
		req.end();
	});
}

// /json/new opens a foreground tab in Chrome, so open it over CDP instead.
async function openBackgroundTab(url) {
	const version = JSON.parse((await chromeHttp("/json/version")).body);
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
	const list = JSON.parse((await chromeHttp("/json/list")).body);
	return list.find((t) => t.id === targetId) ?? { id: targetId };
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

const server = http.createServer(async (req, res) => {
	try {
		const { pathname, search } = new URL(req.url, `http://${HOST}`);
		if (!fromLocalTool(req)) {
			res.writeHead(403, { "content-type": "text/plain" }).end("agent-chrome-proxy: only local tools may connect\n");
			return;
		}
		let status, headers, body;
		if (pathname === "/json/new" && req.method !== "PUT") {
			res.writeHead(405, { "content-type": "text/plain" }).end("agent-chrome-proxy: /json/new needs PUT, as in Chrome\n");
			return;
		}
		if (pathname === "/json/new") {
			const url = decodeURIComponent(search.slice(1)) || "about:blank";
			status = 200;
			headers = { "content-type": "application/json; charset=UTF-8" };
			body = Buffer.from(JSON.stringify(await openBackgroundTab(url), null, 2));
		} else {
			const upstream = await chromeHttp(req.url, req.method);
			status = upstream.res.statusCode;
			headers = { ...upstream.res.headers };
			body = upstream.body;
		}
		if (String(headers["content-type"] ?? "").includes("json")) body = Buffer.from(toProxy(body.toString()));
		headers["content-length"] = body.length;
		headers["x-agent-chrome-proxy"] = "1";
		res.writeHead(status, headers).end(body);
	} catch (err) {
		res.writeHead(502, { "content-type": "text/plain" }).end(`agent-chrome-proxy: ${err.message}\n`);
	}
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: MAX_PAYLOAD });

server.on("upgrade", (req, socket, head) => {
	if (!fromLocalTool(req)) {
		socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
		return;
	}
	const upstream = new WebSocket(`ws://${HOST}:${CHROME}${req.url}`, {
		perMessageDeflate: false,
		maxPayload: MAX_PAYLOAD,
	});
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
		});
	});
});

// See "To run a new version" at the top.
process.on("SIGUSR2", () => server.close());

server.listen(LISTEN, HOST);
