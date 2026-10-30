#!/usr/bin/env node
// agent-login.mjs — sign a tab in this chat's agent-Chrome window in to a site with a login saved
// in 1Password.
//
// It finds the 1Password Login saved for the tab's host, then types whichever of the username,
// password and one-time code fields the page shows. Run it again at each step of a sign-in that
// spans several pages. Logins come from the "Agent Logins" and "Agent-Test" vaults through a
// read-only 1Password service account whose token is in the login Keychain, so there is no prompt;
// without the token, 1Password asks Liam to approve each new use. Values go from `op` straight
// into the page, never to stdout, argv or disk; the script prints only which fields it filled. A
// login is only ever typed into an https page on a host saved on that login (or a subdomain of
// one), and only while the page keeps the origin it had when the run started.
//
// A code the site emailed instead comes from Liam's Gmail inboxes through agent-mail.mjs (read-only
// grant in the Keychain, no approval prompt): pass --email-code, or it is used by itself when the
// page shows only a code box and the site's 1Password login has no code generator.
//
// Usage: agent-login.mjs [--tab <targetId>] [--url <text in the tab's URL>]
//                        [--item <item id or title>] [--account <username>] [--email-code] [--submit]
// Exit codes: 0 filled · 1 error · 2 a choice is needed (choices printed) · 3 nothing to fill ·
// 4 still waiting for Liam's approval in 1Password.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { findEmailCode, keychainGet } from "./agent-mail.mjs";

function fail(message, code = 1) {
  console.error(`agent-login: ${message}`);
  process.exit(code);
}

const opts = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--submit") opts.submit = true;
  else if (args[i] === "--email-code") opts.emailCode = true;
  else if (["--tab", "--url", "--item", "--account"].includes(args[i]) && args[i + 1]) opts[args[i].slice(2)] = args[++i];
  else fail(`unknown or incomplete argument: ${args[i]}`);
}

// Platforms that give each customer a subdomain. A login saved for one customer's site there
// matches that exact host only, never a sibling site on the same platform.
const SHARED_HOSTS = ["vercel.app", "github.io", "netlify.app", "herokuapp.com", "pages.dev", "web.app",
  "firebaseapp.com", "appspot.com", "cloudfront.net", "amazonaws.com", "azurewebsites.net", "blogspot.com",
  "workers.dev", "onrender.com", "fly.dev", "railway.app", "ngrok.io", "ngrok-free.app", "glitch.me", "surge.sh",
  "myshopify.com", "wixsite.com", "webflow.io", "framer.app", "replit.app"];
// SideShift's own Vercel previews (team side-shift). Their emailed codes come from sideshift.app, and
// Liam allowed reading them (10-29). The name alone proves nothing (a team called "x-side-shift" could
// own a matching host), so Vercel must confirm the deployment is in the side-shift team.
const SIDESHIFT_PREVIEW = /^sideshift-[a-z0-9-]+-side-shift\.vercel\.app$/;
const isSideshiftPreview = (host) => SIDESHIFT_PREVIEW.test(host)
  && spawnSync("vercel", ["inspect", host, "--scope", "side-shift"], { encoding: "utf8", timeout: 60_000 }).status === 0;

const normalHost = (host) => host.toLowerCase().replace(/\.$/, "");

function itemHosts(item) {
  return (item.urls || []).flatMap((u) => {
    try {
      return [normalHost(new URL(u.href.includes("://") ? u.href : `https://${u.href}`).hostname).replace(/^www\./, "")];
    } catch {
      return [];
    }
  });
}

// The page must be on a host saved on the item, or on a subdomain of one (compared label by label).
function hostMatches(pageHost, itemHost) {
  if (pageHost === itemHost) return true;
  const shared = SHARED_HOSTS.some((s) => itemHost === s || itemHost.endsWith(`.${s}`));
  return !shared && itemHost.includes(".") && !/^[\d.]+$/.test(itemHost) && pageHost.endsWith(`.${itemHost}`);
}

const savedFor = (item, host) => itemHosts(item).some((h) => hostMatches(host, h));

// The read-only "Agent Logins" service account (vaults Agent Logins + Agent-Test) reads with no
// prompt. Without its token in the Keychain, `op` falls back to asking Liam in the 1Password app.
const serviceToken = keychainGet("agent-login-op-service-account", "token");
const opEnv = serviceToken ? { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: serviceToken } : process.env;

function op(opArgs) {
  const r = spawnSync("op", opArgs, { encoding: "utf8", env: opEnv, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error?.code === "ETIMEDOUT" || /authorization (timeout|prompt dismissed)/i.test(r.stderr || "")) {
    fail("1Password needs Liam's approval: ask Liam to approve the 1Password prompt on the Mac, then run this again", 4);
  }
  if (r.status !== 0) fail(`1Password refused: ${(r.stderr || "no reason given").trim().split("\n")[0]}`);
  return r.stdout;
}

// Runs in the page: marks the visible username, password and one-time-code inputs.
function markFields() {
  const docs = [document];
  for (const frame of document.querySelectorAll("iframe")) {
    try {
      if (frame.contentDocument) docs.push(frame.contentDocument);
    } catch {}
  }
  for (const d of docs) for (const el of d.querySelectorAll("[data-agent-login]")) el.removeAttribute("data-agent-login");
  const shown = (el) => {
    const box = el.getBoundingClientRect();
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return box.width > 2 && box.height > 2 && style.visibility !== "hidden" && style.display !== "none"
      && Number(style.opacity) > 0.05 && !el.disabled && !el.readOnly;
  };
  const skip = new Set(["hidden", "checkbox", "radio", "submit", "button", "image", "file", "range", "color", "date", "search"]);
  const inputs = docs.flatMap((d) => [...d.querySelectorAll("input")]).filter((el) => !skip.has(el.type) && shown(el));
  const words = (el) => {
    const labelledBy = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent);
    return [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.autocomplete,
      ...[...(el.labels || [])].map((label) => label.textContent), ...labelledBy].filter(Boolean).join(" ").toLowerCase();
  };
  const texty = (el) => ["text", "tel", "number", "email"].includes(el.type);
  // A "new-password" box is a sign-up form's, except when it is the only one showing: some login
  // forms (TikTok for Business) mark theirs that way to stop browser autofill.
  const passwords = inputs.filter((el) => el.type === "password");
  const pass = passwords.find((el) => el.autocomplete !== "new-password") || (passwords.length === 1 ? passwords[0] : undefined);
  // One box per digit: some code inputs set maxlength=1, others only mark each box one-time-code.
  const boxes = inputs.filter((el) => texty(el) && (el.maxLength === 1 || el.autocomplete === "one-time-code"));
  const split = boxes.length >= 4 && boxes.length <= 8 ? boxes : [];
  const otp = split.length ? null : inputs.find((el) => texty(el) && el.type !== "email"
    && !/search|promo|coupon|zip|postal|country|referral|invite|gift/.test(words(el))
    && (el.autocomplete === "one-time-code"
      || /one[- ]?time|otp|2fa|two[- ]?(factor|step)|totp|mfa|verif|authenticat|security code|passcode|\bcode\b|\bpin\b|token/.test(words(el))));
  const user = inputs.find((el) => texty(el) && el !== otp && !split.includes(el) && el.type !== "number"
    && (el.type === "email" || /username|email/.test(el.autocomplete) || /user|e-?mail|login|identifier|account/.test(words(el))));
  if (user) user.setAttribute("data-agent-login", "user");
  if (pass) pass.setAttribute("data-agent-login", "pass");
  if (otp) otp.setAttribute("data-agent-login", "otp");
  split.forEach((el, i) => el.setAttribute("data-agent-login", `otp${i}`));
  return { user: Boolean(user), pass: Boolean(pass), otp: Boolean(otp), split: split.length, href: location.href };
}

// Runs in the page: finds an input markFields marked.
function findMarked(marker) {
  const docs = [document, ...[...document.querySelectorAll("iframe")].map((frame) => {
    try {
      return frame.contentDocument;
    } catch {
      return null;
    }
  })].filter(Boolean);
  return docs.map((d) => d.querySelector(`[data-agent-login="${marker}"]`)).find(Boolean) || null;
}

function unmark() {
  for (const el of document.querySelectorAll("[data-agent-login]")) el.removeAttribute("data-agent-login");
}

// An emailed code may have been requested a few minutes before this run.
const mailSince = Date.now() - 10 * 60_000;

const base = spawnSync(`${homedir()}/.claude/bin/agent-chrome.sh`, { encoding: "utf8" }).stdout.trim() || "http://127.0.0.1:9222";
const { webSocketDebuggerUrl } = await (await fetch(`${base}/json/version`)).json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error("cannot reach the agent browser"));
}).catch((e) => fail(e.message));
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  const waiter = msg.id && pending.get(msg.id);
  if (!waiter) return;
  pending.delete(msg.id);
  if (msg.error) waiter.reject(new Error(msg.error.message));
  else waiter.resolve(msg.result);
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
});

let typedSomething = false;
try {
  const { targetInfos } = await send("Target.getTargets");
  let pages = targetInfos.filter((t) => t.type === "page");
  if (opts.tab) {
    pages = pages.filter((t) => t.targetId === opts.tab);
  } else {
    let context = "";
    try {
      context = readFileSync(`${homedir()}/.cache/agent-chrome/chats/${process.env.CLAUDE_CODE_SESSION_ID}`, "utf8").trim();
    } catch {}
    if (!context) fail("cannot tell which browser window belongs to this chat; pass --tab <targetId>");
    pages = pages.filter((t) => t.browserContextId === context);
  }
  if (opts.url) pages = pages.filter((t) => t.url.includes(opts.url));
  pages = pages.filter((t) => /^https?:/.test(t.url));
  if (!pages.length) fail(opts.tab ? `no web page in tab ${opts.tab}` : `no web page open in this chat's window${opts.url ? ` matching "${opts.url}"` : ""}`);
  if (pages.length > 1) {
    console.log("Several tabs match. Run again with --tab <targetId> or --url <text in its URL>:");
    for (const t of pages) {
      const u = new URL(t.url);
      console.log(`  ${t.targetId}  ${u.origin}${u.pathname}`);
    }
    process.exit(2);
  }

  const { sessionId } = await send("Target.attachToTarget", { targetId: pages[0].targetId, flatten: true });
  const evaluate = async (fn, ...params) => {
    const r = await send("Runtime.evaluate", {
      expression: `(${fn})(${params.map((p) => JSON.stringify(p)).join(",")})`, returnByValue: true, awaitPromise: true,
    }, sessionId);
    if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.text}`);
    return r.result.value;
  };
  const call = async (objectId, fn, ...values) => {
    const r = await send("Runtime.callFunctionOn", {
      objectId, functionDeclaration: fn, arguments: values.map((value) => ({ value })), returnByValue: true, awaitPromise: true,
    }, sessionId);
    if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.text}`);
    return r.result.value;
  };
  const element = async (marker) => {
    const r = await send("Runtime.evaluate", { expression: `(${findMarked})(${JSON.stringify(marker)})` }, sessionId);
    return r.result.objectId;
  };

  const fieldsShowing = (f) => f.user || f.pass || f.otp || f.split;
  const before = await evaluate(markFields);
  await evaluate(unmark);
  const page = new URL(before.href);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(page.hostname);
  if (page.protocol !== "https:" && !local) fail(`refusing to type a login into ${page.origin}: the page is not https`);
  const host = normalHost(page.hostname);
  // Previews and local servers: board-browser signs the tab in as a test account, so no saved login is needed.
  if (!opts.emailCode && (local || /^sideshift-.*-side-shift\.vercel\.app$/.test(host)))
    fail(`${host} is a SideShift preview or local server: do not ask Liam. Run node ~/session-board/scripts/board-browser.mjs ${page.origin}${page.pathname} "<what to check>" (add --as creator for creator screens); it signs the tab in as a test account`);
  if (!fieldsShowing(before)) fail(`no username, password or one-time-code field is showing on ${page.origin}${page.pathname}`, 3);

  const codeOnly = !before.user && !before.pass;
  // A service account must name a vault on every list (without --vault, `op` hangs).
  const vaultArgs = () => serviceToken ? JSON.parse(op(["vault", "list", "--format", "json"])).map((v) => ["--vault", v.id]) : [[]];
  const logins = opts.emailCode && codeOnly ? []
    : vaultArgs().flatMap((v) => JSON.parse(op(["item", "list", "--categories", "Login", "--format", "json", ...v])));
  let candidates = logins.filter((it) => savedFor(it, host));
  if (opts.item) {
    const named = logins.filter((it) => it.id === opts.item || (it.title || "").toLowerCase() === opts.item.toLowerCase());
    if (!named.length) fail(`no 1Password login called "${opts.item}"`);
    candidates = named.filter((it) => savedFor(it, host));
    if (!candidates.length) {
      fail(`"${opts.item}" is saved for ${[...new Set(named.flatMap(itemHosts))].join(", ") || "no website"}, not ${host}; `
        + `add ${host} as a website on that item in 1Password if it really signs in here`);
    }
  }
  if (opts.account) {
    candidates = candidates.filter((it) => (it.additional_information || "").toLowerCase() === opts.account.toLowerCase());
  }
  // Emailed codes go only where asked for (--email-code) or to a site Liam saved a login for, and
  // never to a customer site on a shared platform, whose emails would come from the platform.
  const sideshiftPreview = opts.emailCode && isSideshiftPreview(host);
  const sharedHost = !sideshiftPreview && SHARED_HOSTS.some((s) => host === s || host.endsWith(`.${s}`));
  if (opts.emailCode && sharedHost) fail(`refusing to type an emailed code into ${host}: it is a customer site on a shared platform`);
  const fromMail = codeOnly && Boolean(opts.emailCode);
  if (!candidates.length && !fromMail) fail(`no 1Password login is saved for ${host}${opts.account ? ` with username ${opts.account}` : ""}`, 2);
  if (candidates.length > 1 && !fromMail) {
    console.log(`Several 1Password logins are saved for ${host}. Run again with --item <id> (or --account <username>):`);
    for (const it of candidates) console.log(`  ${it.id}  "${it.title}"  ${it.additional_information || "-"}  [vault ${it.vault.name}]`);
    process.exit(2);
  }

  const item = fromMail ? null : candidates[0];
  const fields = item ? JSON.parse(op(["item", "get", item.id, "--vault", item.vault.id, "--format", "json"])).fields || [] : [];
  const username = fields.find((f) => f.purpose === "USERNAME")?.value || "";
  const password = fields.find((f) => f.purpose === "PASSWORD")?.value || "";
  const hasCode = fields.some((f) => f.type === "OTP");
  let code = "";
  let mail = null;
  if (fromMail || (codeOnly && item && !hasCode && !sharedHost)) {
    mail = await findEmailCode({ host: sideshiftPreview ? "app.sideshift.app" : host, since: mailSince, length: before.split || undefined });
    code = mail.code;
  } else if ((before.otp || before.split) && hasCode) {
    // A code typed in its last seconds can expire before the site checks it.
    while (30 - (Math.floor(Date.now() / 1000) % 30) < 5) await new Promise((r) => setTimeout(r, 500));
    code = op(["item", "get", item.id, "--vault", item.vault.id, "--otp"]).trim();
  }

  // The approval prompt can take a while: look at the page again before typing anything into it.
  const found = await evaluate(markFields);
  if (new URL(found.href).origin !== page.origin) {
    await evaluate(unmark);
    fail(`the tab moved to ${new URL(found.href).origin} while 1Password asked for approval; run again`);
  }
  if (!fieldsShowing(found)) fail(`the sign-in fields went away while 1Password asked for approval; run again`, 3);

  await send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
  const clearAndFocus = `function () {
    const set = Object.getOwnPropertyDescriptor(this.ownerDocument.defaultView.HTMLInputElement.prototype, "value").set;
    set.call(this, "");
    this.dispatchEvent(new Event("input", { bubbles: true }));
    this.scrollIntoView({ block: "center" });
    this.focus();
  }`;
  const setValue = `function (v) {
    const set = Object.getOwnPropertyDescriptor(this.ownerDocument.defaultView.HTMLInputElement.prototype, "value").set;
    set.call(this, v);
    this.dispatchEvent(new Event("input", { bubbles: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
  }`;
  const typeInto = async (marker, value) => {
    const id = await element(marker);
    if (!id) return false;
    // The page can still navigate: type only into a field whose page has the origin checked above.
    const origin = await call(id, "function () { return this.ownerDocument.location.origin; }");
    if (origin !== page.origin) throw new Error(`the field is now on ${origin}, not ${page.origin}; nothing more was typed`);
    await call(id, clearAndFocus);
    typedSomething = true;
    await send("Input.insertText", { text: value }, sessionId);
    if (await call(id, "function () { return this.value.length; }") === value.length) return true;
    // Some inputs drop typed text (masked or custom fields): set the value and announce the change.
    await call(id, setValue, value);
    return await call(id, "function () { return this.value.length; }") === value.length;
  };

  const filled = [];
  const notFilled = [];
  let last = "";
  const fill = async (marker, value, name) => {
    if (!value) {
      notFilled.push(`${name} (none saved in 1Password)`);
    } else if (await typeInto(marker, value)) {
      filled.push(name);
      last = marker;
    } else {
      notFilled.push(`${name} (the field would not take it)`);
    }
  };
  if (found.user) await fill("user", username, "username");
  if (found.pass) await fill("pass", password, "password");
  if ((found.otp || found.split) && !code) {
    notFilled.push(hasCode ? "one-time code (the code field appeared while waiting; run again)" : "one-time code (no code generator saved in 1Password)");
  } else if (found.otp || found.split) {
    if (!found.split) {
      await fill("otp", code, "one-time code");
    } else if (code.length !== found.split) {
      notFilled.push(`one-time code (the page has ${found.split} boxes, the code has ${code.length} digits)`);
    } else {
      let ok = true;
      for (let i = 0; ok && i < found.split; i++) ok = await typeInto(`otp${i}`, code[i]);
      if (ok) {
        filled.push("one-time code");
        last = `otp${found.split - 1}`;
      } else {
        notFilled.push("one-time code (the boxes would not take it)");
      }
    }
  }

  let submitted = false;
  if (opts.submit && filled.length) {
    const id = await element(last);
    if (id) await call(id, "function () { this.focus(); }");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r" }, sessionId);
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }, sessionId);
    submitted = true;
  }
  await send("Emulation.setFocusEmulationEnabled", { enabled: false }, sessionId).catch(() => {});
  await evaluate(unmark).catch(() => {});

  const who = mail ? `an email from ${mail.sender} to ${mail.inbox}`
    : `1Password "${item.title}" (${item.additional_information || "no username"}, vault ${item.vault.name})`;
  if (!filled.length) fail(`nothing filled on ${host} from ${who}: ${notFilled.join("; ")}`, 3);
  console.log(`Filled ${filled.join(", ")} on ${host} from ${who}${submitted ? ", then pressed Enter" : ""}.`);
  if (notFilled.length) console.log(`Not filled: ${notFilled.join("; ")}.`);
  process.exit(0);
} catch (e) {
  // Some sites (GitHub's code box, for one) submit by themselves once a value is typed, and the
  // page is gone before the run finishes.
  if (typedSomething && /cannot find context|context was destroyed|target navigated|no node with given id/i.test(e.message)) {
    console.log("Typed into the page, then the page moved on by itself (the site submitted on its own). Look at where it landed.");
    process.exit(0);
  }
  fail(e.message);
}
