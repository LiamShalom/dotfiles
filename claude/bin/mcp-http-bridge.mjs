#!/usr/bin/env node
//
// mcp-http-bridge.mjs — serves an MCP stdio server to every Claude Code session over HTTP, so the
// server runs once instead of once per session. Sessions connect with an http entry for
// http://127.0.0.1:<port>/mcp whose headersHelper is mcp-shared-auth.sh.
//
// The bridge starts the server and does the MCP handshake with it; each session's initialize is
// answered from that. Every request goes on to a server under an id of the bridge's own, so requests
// from different sessions never mix, and the answer goes back to the session that asked. There are no
// HTTP sessions: each POST carries its own JSON-RPC messages and gets a JSON answer (MCP Streamable
// HTTP without the optional event stream). A server cannot ask the sessions anything: roots/list gets
// an empty list, ping an empty answer, anything else "method not found".
//
// With --pool <n>, up to n copies of the server run, for a server that answers one call at a time: two
// start at once, and another whenever every running copy is busy, so a call seldom waits for a start.
// A server starts again after it exits, and, without dropping a call, when a file named with
// --restart-on-change has changed since it started.
//
// Only a request with the token in ~/.config/mcp-shared/token (made on first start, readable by you
// alone) reaches the server. mcp-shared-auth.sh hands it to sessions whose project defines the server.
// Any other caller sees a server with no tools. A request a web page could send is refused outright:
// one with an Origin header, a Host other than 127.0.0.1 or localhost (DNS rebinding), or a body that
// is not JSON.
//
// Usage:  mcp-http-bridge.mjs --port <port> [--pool <n>] [--restart-on-change <file>]... -- <command> [args...]
import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const [command, ...args] = argv.slice(split + 1);
let port = 0;
let pool = 1;
const watched = [];
for (let i = 0; i < split; i += 2) {
	if (argv[i] === "--port") port = Number(argv[i + 1]);
	else if (argv[i] === "--pool") pool = Math.max(1, Number(argv[i + 1]) || 1);
	else if (argv[i] === "--restart-on-change") watched.push(argv[i + 1]);
}
if (split < 0 || !command || !port) {
	console.error("usage: mcp-http-bridge.mjs --port <port> [--pool <n>] [--restart-on-change <file>]... -- <command> [args...]");
	process.exit(2);
}

const PROTOCOL_VERSION = "2025-06-18"; // what the bridge asks a server for; it answers with one it supports
const MAX_BODY = 16 * 1024 * 1024;
const TOKEN_FILE = `${homedir()}/.config/mcp-shared/token`;
const log = (text) => console.error(`${new Date().toISOString()} ${text}`);

// Made once with exclusive create, so bridges that start together end up with the same token.
function loadToken() {
	mkdirSync(TOKEN_FILE.slice(0, TOKEN_FILE.lastIndexOf("/")), { recursive: true, mode: 0o700 });
	try {
		writeFileSync(TOKEN_FILE, `${randomBytes(32).toString("hex")}\n`, { flag: "wx", mode: 0o600 });
	} catch (err) {
		if (err.code !== "EEXIST") throw err;
	}
	return Buffer.from(`Bearer ${readFileSync(TOKEN_FILE, "utf8").trim()}`);
}
const expected = loadToken();
const authorized = (req) => {
	const given = Buffer.from(req.headers.authorization ?? "");
	return given.length === expected.length && timingSafeEqual(given, expected);
};

let servers = []; // running copies: { child, ready, pending, stamps, exited, retired }
const children = new Set(); // every server process still alive, replaced ones included
let handshake = null; // the latest server's answer to initialize, given to every session
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

// Sends a request to a server; resolves with its answer ({ result } or { error }).
function ask(s, msg) {
	const id = ++nextId;
	const answered = new Promise((resolve) => s.pending.set(id, resolve));
	write(s, { ...msg, jsonrpc: "2.0", id });
	return { id, answered };
}

function start() {
	const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
	children.add(child);
	child.on("exit", () => children.delete(child));
	const s = { child, pending: new Map(), stamps: stamps(), exited: false, retired: false, starting: true };
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
		if (!s.retired) log(`server ${child.pid} ${why}`);
		for (const resolve of s.pending.values()) resolve({ error: { code: -32603, message: "The MCP server stopped. Try again." } });
		s.pending.clear();
		servers = servers.filter((x) => x !== s);
	};
	child.on("exit", (code, signal) => ended(`exited (${signal ?? code})`));
	child.on("error", (err) => ended(`did not start: ${err.message}`));
	s.ready = ask(s, {
		method: "initialize",
		params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "mcp-http-bridge", version: "1" } },
	}).answered.then((answer) => {
		if (!answer.result) throw new Error(answer.error?.message ?? "no answer to initialize");
		write(s, { jsonrpc: "2.0", method: "notifications/initialized" });
		handshake = answer.result;
		s.starting = false;
		return answer.result;
	});
	s.ready.catch((err) => {
		log(`server ${child.pid} handshake failed: ${err.message}`);
		child.kill();
	});
	log(`server started (pid ${child.pid}, ${servers.length + 1} of at most ${pool})`);
	servers.push(s);
	return s;
}

function stop(s) {
	s.child.stdin.end();
	setTimeout(() => s.child.kill(), 5000).unref();
}

// The copy to use now: an idle one (or one still starting with nothing queued), else a new one while the
// pool has room, else the least busy. Copies whose files changed finish what they have and are replaced.
function pick() {
	const now = stamps();
	for (const s of servers.filter((x) => x.stamps.some((t, i) => t !== now[i]))) {
		log(`files changed; replacing server ${s.child.pid}`);
		s.retired = true;
		servers = servers.filter((x) => x !== s);
		if (!s.pending.size) stop(s);
	}
	const idle = servers.find((s) => !s.pending.size) ?? servers.find((s) => s.starting && s.pending.size === 1);
	if (idle) return idle;
	if (servers.length < pool) return start();
	return servers.reduce((a, b) => (b.pending.size < a.pending.size ? b : a));
}

// Starts a spare copy when every running one is busy and the pool has room.
function spare() {
	if (servers.length < pool && !servers.some((s) => !s.pending.size || s.starting)) start();
}

// One JSON-RPC message from a session; resolves with the answer, or null for a notification.
async function handle(msg, res, allowed) {
	if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
	// Notifications (initialized, cancelled) and answers to server requests: the bridge did the handshake
	// itself and never asks a session anything.
	if (msg.id === undefined || msg.method === undefined) return null;
	const reply = (outcome) => ({ jsonrpc: "2.0", id: msg.id, ...outcome });
	if (msg.method === "ping") return reply({ result: {} });
	// Claude Code probes with server/discover before initialize. The bridge does the handshake itself, so it
	// answers as a server without discovery does; the probe never reaches (or wakes) a server.
	if (msg.method === "server/discover") return reply({ error: { code: -32601, message: "Method not found" } });
	if (!allowed) {
		if (msg.method === "initialize") {
			return reply({ result: { protocolVersion: msg.params?.protocolVersion ?? PROTOCOL_VERSION, capabilities: {}, serverInfo: { name: "not available in this project", version: "1" } } });
		}
		if (msg.method === "tools/list") return reply({ result: { tools: [] } });
		if (msg.method === "resources/list") return reply({ result: { resources: [] } });
		if (msg.method === "prompts/list") return reply({ result: { prompts: [] } });
		const why = "No token for this server. Claude Code sessions get one when they start in a project whose .mcp.json defines the server; restart such a session to reconnect with it.";
		return reply({ error: { code: -32001, message: why } });
	}
	if (msg.method === "initialize" && handshake) return reply({ result: handshake });
	let s;
	let init;
	// A copy can be replaced while this request waits for it to be ready; then use another.
	for (let tries = 0; !s || s.retired || s.exited; tries++) {
		if (tries === 3) return reply({ error: { code: -32603, message: "The MCP server keeps restarting. Try again." } });
		s = pick();
		try {
			init = await s.ready;
		} catch (err) {
			return reply({ error: { code: -32603, message: `The MCP server did not start: ${err.message}` } });
		}
	}
	if (msg.method === "initialize") return reply({ result: init });
	const { id, answered } = ask(s, msg);
	spare();
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
	const allowed = authorized(req);
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
		const answers = (await Promise.all((Array.isArray(body) ? body : [body]).map((msg) => handle(msg, res, allowed)))).filter(Boolean);
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
	// Start now, so the first session does not wait for a server.
	for (let i = 0; i < Math.min(2, pool); i++) start();
});

// Closing a server's input ends it cleanly; a signal at the same moment crashes toolbox's stdin reader.
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
	process.on(sig, () => {
		for (const child of children) child.stdin.end();
		const deadline = Date.now() + 2000;
		setInterval(() => {
			if (children.size && Date.now() < deadline) return;
			process.exit(0);
		}, 50);
	});
}
process.on("exit", () => {
	for (const child of children) child.kill();
});
