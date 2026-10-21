#!/usr/bin/env node
//
// mcp-http-bridge.mjs — serves one MCP stdio server to every Claude Code session over HTTP, so the
// server runs once instead of once per session. Sessions connect with
// `claude mcp add --transport http <name> http://127.0.0.1:<port>/mcp`.
//
// The bridge starts the server and does the MCP handshake with it once; each session's initialize is
// answered from that. Every request goes on to the server under an id of the bridge's own, so requests
// from different sessions never mix, and the answer goes back to the session that asked. There are no
// HTTP sessions: each POST carries its own JSON-RPC messages and gets a JSON answer (MCP Streamable
// HTTP without the optional event stream). The server cannot ask the sessions anything: roots/list gets
// an empty list, ping an empty answer, anything else "method not found".
//
// The server starts again after it exits, and, without dropping a request, when a file named with
// --restart-on-change has changed since it started (its code, its start script, its credentials).
//
// Only programs on this Mac can use it. It listens on 127.0.0.1 and refuses what a web page could send:
// a request with an Origin header, a Host other than 127.0.0.1 or localhost (DNS rebinding), or a
// body that is not JSON.
//
// Usage:  mcp-http-bridge.mjs --port <port> [--restart-on-change <file>]... -- <command> [args...]
import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { createServer } from "node:http";

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const [command, ...args] = argv.slice(split + 1);
let port = 0;
const watched = [];
for (let i = 0; i < split; i += 2) {
	if (argv[i] === "--port") port = Number(argv[i + 1]);
	else if (argv[i] === "--restart-on-change") watched.push(argv[i + 1]);
}
if (split < 0 || !command || !port) {
	console.error("usage: mcp-http-bridge.mjs --port <port> [--restart-on-change <file>]... -- <command> [args...]");
	process.exit(2);
}

const PROTOCOL_VERSION = "2025-06-18"; // what the bridge asks the server for; it answers with one it supports
const MAX_BODY = 16 * 1024 * 1024;
const log = (text) => console.error(`${new Date().toISOString()} ${text}`);

let server = null; // { child, ready, pending, stamps, exited, retired }
let nextId = 0;

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
}

const stamps = () =>
	watched.map((file) => {
		try {
			return statSync(file).mtimeMs;
		} catch {
			return 0;
		}
	});

const write = (s, msg) => s.child.stdin.write(JSON.stringify(msg) + "\n");

// Sends a request to the server; resolves with its answer ({ result } or { error }).
function ask(s, msg) {
	const id = ++nextId;
	const answered = new Promise((resolve) => s.pending.set(id, resolve));
	write(s, { ...msg, jsonrpc: "2.0", id });
	return { id, answered };
}

function start() {
	const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
	const s = { child, pending: new Map(), stamps: stamps(), exited: false, retired: false };
	child.stdin.on("error", () => undefined); // a server that died mid-write; its exit is handled below
	eachLine(child.stdout, (line) => {
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		if (msg.method === undefined) {
			const resolve = s.pending.get(msg.id);
			s.pending.delete(msg.id);
			resolve?.(msg);
			if (s.retired && !s.pending.size) stop(s);
			return;
		}
		if (msg.id === undefined) return; // a notification (log line, progress): no session to send it to
		if (msg.method === "roots/list") write(s, { jsonrpc: "2.0", id: msg.id, result: { roots: [] } });
		else if (msg.method === "ping") write(s, { jsonrpc: "2.0", id: msg.id, result: {} });
		else write(s, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
	});
	const ended = (why) => {
		if (s.exited) return;
		s.exited = true;
		if (!s.retired) log(`server ${why}`);
		for (const resolve of s.pending.values()) resolve({ error: { code: -32603, message: "The MCP server stopped. Try again." } });
		s.pending.clear();
		if (server === s) server = null;
	};
	child.on("exit", (code, signal) => ended(`exited (${signal ?? code})`));
	child.on("error", (err) => ended(`did not start: ${err.message}`));
	s.ready = ask(s, {
		method: "initialize",
		params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "mcp-http-bridge", version: "1" } },
	}).answered.then((answer) => {
		if (!answer.result) throw new Error(answer.error?.message ?? "no answer to initialize");
		write(s, { jsonrpc: "2.0", method: "notifications/initialized" });
		return answer.result;
	});
	s.ready.catch((err) => {
		log(`server handshake failed: ${err.message}`);
		child.kill();
	});
	log(`server started (pid ${child.pid})`);
	return s;
}

function stop(s) {
	s.child.stdin.end();
	setTimeout(() => s.child.kill(), 5000).unref();
}

// The server to use now. One whose files changed finishes what it has and is replaced.
function current() {
	if (server && stamps().some((t, i) => t !== server.stamps[i])) {
		log("files changed; restarting the server");
		server.retired = true;
		if (!server.pending.size) stop(server);
		server = null;
	}
	server ??= start();
	return server;
}

// One JSON-RPC message from a session; resolves with the answer, or null for a notification.
async function handle(msg, res) {
	if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
	// Notifications (initialized, cancelled) and answers to server requests: the bridge did the handshake
	// itself and never asks a session anything.
	if (msg.id === undefined || msg.method === undefined) return null;
	const reply = (outcome) => ({ jsonrpc: "2.0", id: msg.id, ...outcome });
	if (msg.method === "ping") return reply({ result: {} });
	let s;
	let init;
	// A server can be replaced while this request waits for it to be ready; then use the new one.
	for (let tries = 0; !s || s.retired || s.exited; tries++) {
		if (tries === 3) return reply({ error: { code: -32603, message: "The MCP server keeps restarting. Try again." } });
		s = current();
		try {
			init = await s.ready;
		} catch (err) {
			return reply({ error: { code: -32603, message: `The MCP server did not start: ${err.message}` } });
		}
	}
	if (msg.method === "initialize") return reply({ result: init });
	const { id, answered } = ask(s, msg);
	// A session that gives up (a timeout, Esc) closes its request: tell the server to stop working on it.
	const gaveUp = () => {
		if (res.writableEnded || !s.pending.delete(id)) return;
		write(s, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "The client closed the request." } });
		if (s.retired && !s.pending.size) stop(s);
	};
	res.once("close", gaveUp);
	const answer = await answered;
	res.off("close", gaveUp);
	const { jsonrpc, id: _, ...outcome } = answer;
	return reply(outcome);
}

function respond(res, status, body, headers = {}) {
	res.writeHead(status, { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers });
	res.end(body === undefined ? undefined : JSON.stringify(body));
}

const http = createServer((req, res) => {
	const host = (req.headers.host ?? "").replace(/:\d+$/, "");
	if (req.headers.origin !== undefined || (host !== "127.0.0.1" && host !== "localhost")) return respond(res, 403, { error: "Forbidden" });
	if (req.url !== "/mcp") return respond(res, 404, { error: "Not found: the MCP endpoint is /mcp" });
	if (req.method !== "POST") return respond(res, 405, undefined, { allow: "POST" });
	if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return respond(res, 415, { error: "The body must be JSON" });
	const chunks = [];
	let size = 0;
	req.on("data", (chunk) => {
		size += chunk.length;
		if (size > MAX_BODY) req.destroy();
		else chunks.push(chunk);
	});
	req.on("end", async () => {
		let body;
		try {
			body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			return respond(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
		}
		const answers = (await Promise.all((Array.isArray(body) ? body : [body]).map((msg) => handle(msg, res)))).filter(Boolean);
		if (res.destroyed) return;
		if (!answers.length) return respond(res, 202);
		respond(res, 200, Array.isArray(body) ? answers : answers[0]);
	});
});

http.on("error", (err) => {
	log(`cannot listen on 127.0.0.1:${port}: ${err.message}`);
	process.exit(1);
});
http.listen(port, "127.0.0.1", () => {
	log(`listening on http://127.0.0.1:${port}/mcp for: ${[command, ...args].join(" ")}`);
	current(); // start the server now, so the first session does not wait for it
});

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
	process.on(sig, () => {
		server?.child.kill();
		process.exit(0);
	});
}
