#!/usr/bin/env node
// agent-sms.mjs — read sign-in codes that sites text to Liam's phone, so agent-login.mjs can type
// them into the agent's tab.
//
// Liam's iPhone forwards texts to this Mac's Messages app (Text Message Forwarding), which keeps
// them in ~/Library/Messages/chat.db. This file opens that database read-only; the process needs
// Full Disk Access. A text's sender cannot be verified, so a code is only taken from a text that
// arrived in the last few minutes and either names the page's site ("Your LinkedIn code is …") or
// carries the site's domain-bound line ("@linkedin.com #123456"). Only SMS and RCS are read (sites
// do not send codes by iMessage); older texts and texts that name no site are never used. This file never prints a code or a message: agent-login
// imports findTextCode and types the code itself.
//
// Usage: agent-sms.mjs status    check that Messages can be read and when the last text arrived
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { extractCode, site } from "./agent-mail.mjs";

const DB = `${homedir()}/Library/Messages/chat.db`;
// Messages stores times as nanoseconds since 2001-01-01.
const APPLE_EPOCH = 978307200;
const toApple = (ms) => BigInt(Math.floor(ms / 1000) - APPLE_EPOCH) * 1_000_000_000n;
const fromApple = (ns) => (Number(BigInt(ns) / 1_000_000n) + APPLE_EPOCH * 1000);

function query(sql) {
  const r = spawnSync("/usr/bin/sqlite3", ["-readonly", "-json", DB, sql], { encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(/authorization denied|unable to open|not permitted/i.test(r.stderr)
      ? "cannot read Messages: this process has no Full Disk Access (System Settings > Privacy & Security > Full Disk Access)"
      : "reading Messages failed");
  }
  return r.stdout.trim() ? JSON.parse(r.stdout) : [];
}

// Newer texts keep their words only in attributedBody, an NSAttributedString in Apple's typedstream
// format: the string follows the "NSString" class name, a "+" type tag and a length.
export function decodeAttributedBody(buf) {
  const at = buf.indexOf("NSString");
  if (at < 0) return "";
  const plus = buf.indexOf(0x2b, at + 8);
  if (plus < 0 || plus > at + 16) return "";
  let i = plus + 1;
  let len = buf[i++];
  if (len === 0x81) [len, i] = [buf.readUInt16LE(i), i + 2];
  else if (len === 0x82) [len, i] = [buf.readUInt32LE(i), i + 4];
  return buf.subarray(i, i + len).toString("utf8");
}

const textOf = (row) => row.text ?? (row.body ? decodeAttributedBody(Buffer.from(row.body, "hex")) : "");

const GENERIC = /^(code|codes|verify|verification|verified|confirm|confirmation|login|log|signin|sign|account|accounts|auth|authenticate|authentication|otp|pin|passcode|password|secure|security|one|time|onetime|your|you|is|use|the|text|sms|message|msg|reply|stop|help|app|my|id|token|access|number|phone|mobile|alert|notice)$/i;

// The code a text holds for `host`, or "" when the text does not belong to that site.
export function codeForSite(text, host, length) {
  const want = site(host);
  // Domain-bound line (WebOTP): "@example.com #123456", the last line of the text.
  const bound = text.match(/@([a-z0-9.-]+\.[a-z]{2,})\s+#([A-Za-z0-9]{4,10})\s*$/i);
  if (bound) return site(bound[1]) === want && (!length || bound[2].length === length) ? bound[2] : "";
  // The site's name as a whole word ("x" must not match any word with an x in it). A site named
  // after a word every code text uses ("code.app", "verification.com") would match any site's text.
  const brand = want.split(".")[0];
  if (GENERIC.test(brand)) return "";
  if (!new RegExp(`(^|[^a-z0-9])${brand}($|[^a-z0-9])`, "i").test(text)) return "";
  // Google writes "G-123456"; the dash would otherwise hide the code.
  return extractCode("", text.replace(/\bG-(\d{4,8})\b/g, " $1"), length);
}

// Waits for a texted code for `host` that arrived after `since` (ms). Returns { code, sender } or
// throws. `length` is the code length the page expects, if known.
export async function findTextCode({ host, since, length, timeoutMs = 120_000 }) {
  const want = site(host);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = query(`SELECT m.text, hex(m.attributedBody) AS body, CAST(m.date AS TEXT) AS date, h.id AS sender
      FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE m.is_from_me = 0 AND m.service IN ('SMS', 'RCS') AND m.date > ${toApple(since)} ORDER BY m.date DESC LIMIT 200`);
    let skipped = 0;
    for (const row of rows) {
      const code = codeForSite(textOf(row), host, length);
      if (code) return { code, sender: row.sender || "an unknown sender", at: fromApple(row.date) };
      skipped++;
    }
    if (Date.now() > deadline) {
      throw new Error(`no texted code for ${want} arrived in ${Math.round(timeoutMs / 1000)} s`
        + (skipped ? ` (ignored ${skipped} text${skipped === 1 ? "" : "s"} that did not name ${want} or held no code)` : ""));
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function main([command]) {
  if (command !== "status") throw new Error("usage: agent-sms.mjs status");
  const [last] = query(`SELECT CAST(MAX(date) AS TEXT) AS date FROM message WHERE is_from_me = 0 AND service IN ('SMS', 'RCS')`);
  if (!last?.date) {
    console.log("Messages can be read, but no text message has arrived. Turn on Text Message Forwarding for this Mac on the iPhone.");
    return;
  }
  const mins = Math.round((Date.now() - fromApple(last.date)) / 60_000);
  console.log(`Working: Messages can be read; the last text message arrived ${mins < 120 ? `${mins} min` : `${Math.round(mins / 60)} h`} ago.`);
}

if (typeof process !== "undefined" && process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`agent-sms: ${e.message}`);
    process.exit(1);
  }
}
