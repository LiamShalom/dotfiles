#!/usr/bin/env node
// agent-mail.mjs — read sign-in codes that sites email to Liam's Gmail inboxes, so agent-login.mjs
// can type them into the agent's tab.
//
// It holds a read-only Gmail grant per inbox in the macOS login Keychain. A code is only taken from
// a message that arrived in the last few minutes, whose sender domain is the same site as the page,
// and that Gmail itself marked DMARC-pass (so a forged sender cannot plant a code). This file never
// prints a code, a token or a message: agent-login imports findEmailCode and types the code itself.
//
// Usage: agent-mail.mjs setup <downloaded OAuth client .json>   store the Desktop OAuth client
//        agent-mail.mjs connect                                 grant one inbox (run once per inbox)
//        agent-mail.mjs status                                  list inboxes and check each grant
//        agent-mail.mjs disconnect <address>                    forget one inbox
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const CLIENT_ITEM = "agent-mail-oauth-client";
const TOKEN_ITEM = "agent-mail-gmail";
const SCOPES = "openid email https://www.googleapis.com/auth/gmail.readonly";

function keychainRead(service, account) {
  const r = spawnSync("security", ["find-generic-password", "-s", service, "-a", account, "-w"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

// `security -i` reads its command from stdin, so the secret never appears in a process's argv.
// Values are base64, which needs no quoting.
function keychainWrite(service, account, value) {
  const b64 = Buffer.from(value).toString("base64");
  const r = spawnSync("security", ["-i"], { input: `add-generic-password -U -s ${service} -a ${account} -w ${b64}\n`, encoding: "utf8" });
  if (r.status !== 0 || /error/i.test(r.stderr || "")) throw new Error(`Keychain refused the write: ${(r.stderr || "").trim()}`);
}

const keychainGet = (service, account) => {
  const raw = keychainRead(service, account);
  return raw ? Buffer.from(raw, "base64").toString("utf8") : "";
};

function client() {
  const raw = keychainGet(CLIENT_ITEM, "client");
  if (!raw) throw new Error("no Gmail OAuth client stored; run agent-mail.mjs setup <client.json> first");
  return JSON.parse(raw);
}

const inboxes = () => (keychainGet(TOKEN_ITEM, "_inboxes") || "").split(",").filter(Boolean);

async function accessToken(address) {
  const refresh = keychainGet(TOKEN_ITEM, address);
  if (!refresh) throw new Error(`${address} is not connected`);
  const { client_id, client_secret } = client();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id, client_secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Google refused the ${address} grant (${body.error}); run agent-mail.mjs connect again for it`);
  return body.access_token;
}

async function gmail(token, path) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Gmail answered ${r.status} for ${path.split("?")[0]}`);
  return r.json();
}

// "dashboard.stripe.com" → "stripe.com"; "mail.example.co.uk" → "example.co.uk".
export function site(host) {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  const n = labels.length >= 3 && labels.at(-1).length === 2 && ["co", "com", "org", "net", "ac", "gov", "edu"].includes(labels.at(-2)) ? 3 : 2;
  return labels.slice(-n).join(".");
}

const header = (msg, name) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

// The sender passed DMARC for its From domain, as judged by Gmail's own receiving server. Only the
// topmost Authentication-Results counts: Gmail adds it last, and a sender can forge any below it.
export function dmarcPassFor(msg, fromDomain) {
  const top = (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === "authentication-results");
  if (!top || !/^\s*mx\.google\.com\b/i.test(top.value)) return false;
  const m = top.value.match(/dmarc=pass\b[^;]*header\.from=([^\s;)]+)/i);
  return Boolean(m && m[1].toLowerCase() === fromDomain);
}

function bodyText(part) {
  const texts = [];
  const html = [];
  const walk = (p) => {
    if (!p) return;
    if (p.body?.data) {
      const s = Buffer.from(p.body.data, "base64url").toString("utf8");
      if (p.mimeType === "text/plain") texts.push(s);
      else if (p.mimeType === "text/html") html.push(s);
    }
    (p.parts || []).forEach(walk);
  };
  walk(part);
  if (texts.length) return texts.join("\n");
  return html.join("\n")
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d));
}

// Picks the one-time code out of a message. A candidate counts only near a word such as "code" or
// "verify", or in the subject line.
export function extractCode(subject, text, length) {
  const keyword = /code|verif|otp|one[- ]?time|passcode|\bpin\b|security|confirm|log ?in|sign ?in|authenticat/i;
  const candidates = [];
  for (const [where, hay] of [["subject", subject], ["body", text]]) {
    const re = /(?<![\w#$£€.,:/@-])(\d{3}[ -]\d{3}|\d{4,8}|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8})(?![\w,/@%-]|[.,]\d)/g;
    for (const m of hay.matchAll(re)) {
      const code = m[1].replace(/[ -]/g, "");
      const near = hay.slice(Math.max(0, m.index - 80), m.index + m[1].length + 40);
      let score = (keyword.test(near) ? 3 : 0) + (where === "subject" ? 2 : 0);
      if (/^(19|20)\d\d$/.test(code)) score -= 5;
      if (length && code.length === length) score += 2;
      if (length && code.length !== length) score -= 3;
      candidates.push({ code, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.score >= 3 ? candidates[0].code : "";
}

// Waits for an emailed code for `host` that arrived after `since` (ms). Returns
// { code, inbox, sender } or throws. `length` is the code length the page expects, if known.
export async function findEmailCode({ host, since, length, timeoutMs = 90_000 }) {
  const addresses = inboxes();
  if (!addresses.length) throw new Error("no Gmail inbox is connected; run agent-mail.mjs connect");
  const want = site(host);
  const tokens = await Promise.all(addresses.map(async (a) => [a, await accessToken(a)]));
  const deadline = Date.now() + timeoutMs;
  const seen = new Set();
  const skipped = [];
  for (;;) {
    let best = null;
    for (const [address, token] of tokens) {
      const q = encodeURIComponent(`in:anywhere -in:trash after:${Math.floor(since / 1000)}`);
      const { messages = [] } = await gmail(token, `messages?q=${q}&maxResults=20`);
      for (const { id } of messages) {
        if (seen.has(id)) continue;
        seen.add(id);
        const msg = await gmail(token, `messages/${id}?format=full`);
        if (Number(msg.internalDate) < since) continue;
        const from = header(msg, "From").match(/@([^>\s]+)>?\s*$/)?.[1]?.toLowerCase() || "";
        if (!from || site(from) !== want) continue;
        if (!dmarcPassFor(msg, from)) {
          skipped.push(`a message from ${from} that failed Gmail's sender check`);
          continue;
        }
        const code = extractCode(header(msg, "Subject"), bodyText(msg.payload), length);
        if (!code) {
          skipped.push(`a message from ${from} with no code in it`);
          continue;
        }
        if (!best || Number(msg.internalDate) > best.at) best = { code, inbox: address, sender: from, at: Number(msg.internalDate) };
      }
    }
    if (best) return best;
    if (Date.now() > deadline) {
      throw new Error(`no code from ${want} reached ${addresses.join(" or ")} in ${Math.round(timeoutMs / 1000)} s`
        + (skipped.length ? ` (ignored ${[...new Set(skipped)].join("; ")})` : ""));
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
}

async function connect() {
  const { client_id, client_secret } = client();
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("hex");
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname !== "/") return res.writeHead(404).end();
    const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
    res.writeHead(200, { "content-type": "text/plain" }).end(ok ? "Connected. You can close this tab." : "Not connected. Run the command again.");
    finish(ok ? u.searchParams.get("code") : null);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id, redirect_uri: redirect, response_type: "code", scope: SCOPES, state, access_type: "offline", prompt: "consent select_account",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  })}`;
  // Liam's own browser: Google ends sign-ins in the agent Chrome.
  spawnSync("open", [url]);
  console.log("Opened Google's consent page in your default browser. Pick the inbox to connect.");
  const timer = setTimeout(() => finish(null), 5 * 60_000);
  const code = await done;
  clearTimeout(timer);
  server.close();
  if (!code) throw new Error("no consent came back in 5 minutes");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id, client_secret, code, code_verifier: verifier, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Google refused the consent (${body.error})`);
  if (!body.refresh_token) throw new Error("Google sent no refresh token; run connect again");
  if (!(body.scope || "").includes("gmail.readonly")) throw new Error("the Gmail read box was not ticked on the consent page; run connect again and tick it");
  const { emailAddress } = await gmail(body.access_token, "profile");
  const address = emailAddress.toLowerCase();
  keychainWrite(TOKEN_ITEM, address, body.refresh_token);
  keychainWrite(TOKEN_ITEM, "_inboxes", [...new Set([...inboxes(), address])].join(","));
  console.log(`Connected ${address} (read-only).`);
}

async function main([command, arg]) {
  if (command === "setup") {
    if (!arg) throw new Error("usage: agent-mail.mjs setup <client.json>");
    const json = JSON.parse(readFileSync(arg, "utf8"));
    const c = json.installed;
    if (!c?.client_id || !c?.client_secret) throw new Error("that file is not a Desktop app OAuth client (no \"installed\" section)");
    keychainWrite(CLIENT_ITEM, "client", JSON.stringify({ client_id: c.client_id, client_secret: c.client_secret }));
    console.log(`Stored the OAuth client ${c.client_id.split("-")[0]}… in the Keychain. You can delete ${arg} now.`);
  } else if (command === "connect") {
    await connect();
  } else if (command === "status") {
    const list = inboxes();
    if (!list.length) console.log("No inbox connected.");
    for (const a of list) {
      try {
        const { emailAddress } = await gmail(await accessToken(a), "profile");
        console.log(`${a}: working (${emailAddress})`);
      } catch (e) {
        console.log(`${a}: broken: ${e.message}`);
      }
    }
  } else if (command === "disconnect") {
    if (!arg) throw new Error("usage: agent-mail.mjs disconnect <address>");
    spawnSync("security", ["delete-generic-password", "-s", TOKEN_ITEM, "-a", arg.toLowerCase()]);
    keychainWrite(TOKEN_ITEM, "_inboxes", inboxes().filter((a) => a !== arg.toLowerCase()).join(","));
    console.log(`Forgot ${arg}.`);
  } else {
    throw new Error("usage: agent-mail.mjs setup <client.json> | connect | status | disconnect <address>");
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`agent-mail: ${e.message}`);
    process.exit(1);
  });
}
