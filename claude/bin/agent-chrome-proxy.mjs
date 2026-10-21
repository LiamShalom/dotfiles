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
//
// Everything else passes through unchanged. The JSON endpoints are rewritten
// to name this port, so clients that read webSocketDebuggerUrl stay on the
// proxy.
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
				upstream.send(JSON.stringify(msg));
			});
			upstream.on("message", (data, isBinary) => client.send(data, { binary: isBinary }));

			client.on("close", () => upstream.close());
			upstream.on("close", () => client.close());
		});
	});
});

server.listen(LISTEN, HOST);
