// Shared website matching and credential lookup. Secret values stay inside the login tools.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { findEmailCode, keychainGet } from "./agent-mail.mjs";
import { findTextCode } from "./agent-sms.mjs";

export class LoginError extends Error {
  constructor(message, code = 1) { super(message); this.name = "LoginError"; this.code = code; }
}
const fail = (message, code) => { throw new LoginError(message, code); };

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

// Staff dashboard uses SideShift mail on its exact production alias.
export const dashboardMailHost = host => host === "sideshifters.vercel.app" ? "app.sideshift.app" : null;

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
export function hostMatches(pageHost, itemHost) {
  if (pageHost === itemHost) return true;
  const shared = SHARED_HOSTS.some((s) => itemHost === s || itemHost.endsWith(`.${s}`));
  return !shared && itemHost.includes(".") && !/^[\d.]+$/.test(itemHost) && pageHost.endsWith(`.${itemHost}`);
}

const savedFor = (item, host) => itemHosts(item).some((h) => hostMatches(host, h));

export function selectLogin(logins, host, opts = {}) {
  host = normalHost(host);
  let candidates = logins.filter((it) => savedFor(it, host));
  if (opts.item) {
    const named = logins.filter((it) => it.id === opts.item || (it.title || "").toLowerCase() === opts.item.toLowerCase());
    if (!named.length) fail(`no 1Password login called "${opts.item}"`);
    candidates = named.filter((it) => savedFor(it, host));
    if (!candidates.length) fail(`"${opts.item}" is saved for ${[...new Set(named.flatMap(itemHosts))].join(", ") || "no website"}, not ${host}`);
  }
  if (opts.account) candidates = candidates.filter((it) => (it.additional_information || "").toLowerCase() === opts.account.toLowerCase());
  if (!candidates.length) fail(`no 1Password login is saved for ${host}`, 2);
  if (candidates.length > 1) fail(`Several 1Password logins match ${host}; pass item with one of these titles: ${candidates.map(it => it.title).join(", ")}`, 2);
  return candidates[0];
}

function createOp() {
  const token = keychainGet("agent-login-op-service-account", "token");
  if (!token) fail("1Password service-account token is missing or Keychain is locked; no interactive sign-in was attempted", 4);
  const env = { HOME: homedir(), TMPDIR: tmpdir(), PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    OP_SERVICE_ACCOUNT_TOKEN: token, OP_BIOMETRIC_UNLOCK_ENABLED: "false" };
  // op ignores a template on stdin unless stdin is a FIFO, and Node gives it a socket, so a
  // template goes through an owner-only temp file that is removed right after the call.
  return (args, template) => {
    const dir = template ? mkdtempSync(join(tmpdir(), "agent-login-")) : null;
    if (dir) { writeFileSync(join(dir, "item.json"), template, { mode: 0o600 }); args = [...args, "--template", join(dir, "item.json")]; }
    let r;
    try { r = spawnSync("op", args, { encoding: "utf8", env, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }); }
    finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
    // CLI stderr can include item content. Never forward it to the agent transcript.
    if (r.status !== 0) fail(r.error?.code === "ETIMEDOUT" ? "1Password request timed out" : "1Password refused the service-account request");
    return r.stdout;
  };
}

export function listSavedLogins(href, opts = {}, request) {
  const page = new URL(href);
  if (page.protocol !== "https:") fail("Saved-login discovery requires https");
  if (!["Agent-Test", "Agent Logins"].includes(opts.vault)) fail("Choose the Agent-Test or Agent Logins vault");
  const op = request || createOp();
  const vault = JSON.parse(op(["vault", "list", "--format", "json"])).find(v => v.name === opts.vault);
  if (!vault) fail(`The ${opts.vault} vault is not available`, 2);
  return JSON.parse(op(["item", "list", "--categories", "Login", "--format", "json", "--vault", vault.id]))
    .filter(item => savedFor(item, normalHost(page.hostname)))
    .map(item => ({id:item.id, title:item.title, vault:vault.name, websites:itemHosts(item)}));
}

// Save a test account's login to Agent-Test only. Values go to op in a template (never argv) and
// nothing op returns is passed back except the item id, so no secret reaches the transcript.
export function saveTestLogin({ title, url, username, password }, request) {
  if (!title || !username || !password) fail("A title, username and password are required");
  let site;
  try { site = new URL(url); } catch { fail("The website must be a full https URL"); }
  if (site.protocol !== "https:") fail("The website must be https");
  const op = request || createOp();
  const vault = JSON.parse(op(["vault", "list", "--format", "json"])).find(v => v.name === "Agent-Test");
  if (!vault) fail("The Agent-Test vault is not available", 2);
  const same = JSON.parse(op(["item", "list", "--categories", "Login", "--format", "json", "--vault", vault.id]))
    .filter(it => (it.title || "").toLowerCase() === title.toLowerCase());
  if (same.length > 1) fail(`Several Agent-Test logins are called "${title}"; rename one first`, 2);
  if (same.length) {
    const item = JSON.parse(op(["item", "get", same[0].id, "--vault", vault.id, "--format", "json"]));
    const fields = item.fields || [];
    const set = (purpose, value, type) => {
      const f = fields.find(x => x.purpose === purpose);
      if (f) f.value = value; else fields.push({ id: purpose.toLowerCase(), type, purpose, label: purpose.toLowerCase(), value });
    };
    set("USERNAME", username, "STRING");
    set("PASSWORD", password, "CONCEALED");
    item.fields = fields;
    const urls = item.urls || [];
    if (!urls.some(u => u.href === site.href)) urls.push({ href: site.href, primary: !urls.length });
    item.urls = urls;
    op(["item", "edit", item.id, "--vault", vault.id, "--format", "json"], JSON.stringify(item));
    return { id: item.id, title: item.title, vault: vault.name, action: "updated" };
  }
  const template = { title, category: "LOGIN", urls: [{ href: site.href, primary: true }], fields: [
    { id: "username", type: "STRING", purpose: "USERNAME", label: "username", value: username },
    { id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", value: password },
  ] };
  const created = JSON.parse(op(["item", "create", "--vault", vault.id, "--format", "json"], JSON.stringify(template)));
  return { id: created.id, title, vault: vault.name, action: "created" };
}

export async function resolveLogin(href, before, opts = {}) {
  const page = new URL(href);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(page.hostname);
  if (page.protocol !== "https:" && !(page.protocol === "http:" && local)) fail("refusing to read a login for a page that is not https");
  const host = normalHost(page.hostname);
  const codeOnly = !before.user && !before.pass;
  const sideshiftPreview = opts.emailCode && isSideshiftPreview(host);
  const staffMailHost = dashboardMailHost(host);
  const sharedHost = !staffMailHost && !sideshiftPreview && SHARED_HOSTS.some((s) => host === s || host.endsWith(`.${s}`));
  if (opts.emailCode && sharedHost) fail(`refusing to type an emailed code into ${host}: it is a customer site on a shared platform`);
  if (opts.smsCode && sharedHost) fail(`refusing to type a texted code into ${host}: it is a customer site on a shared platform`);
  const fromText = codeOnly && Boolean(opts.smsCode);
  const fromMail = codeOnly && Boolean(opts.emailCode) && !fromText;
  // A texted code has no checkable sender, so it goes only to a site with a saved login.
  const op = fromMail ? null : createOp();
  const logins = fromMail ? [] : JSON.parse(op(["vault", "list", "--format", "json"]))
    .flatMap(v => JSON.parse(op(["item", "list", "--categories", "Login", "--format", "json", "--vault", v.id])));
  const item = fromMail ? null : selectLogin(logins, host, opts);
  const fields = item && !fromText ? JSON.parse(op(["item", "get", item.id, "--vault", item.vault.id, "--format", "json"])).fields || [] : [];
  const username = fields.find((f) => f.purpose === "USERNAME")?.value || "";
  const password = fields.find((f) => f.purpose === "PASSWORD")?.value || "";
  const hasCode = fields.some((f) => f.type === "OTP");
  let code = "";
  let mail = null;
  let sms = null;
  if (fromText) {
    sms = await findTextCode({ host, since: Date.now() - 5 * 60_000, length: before.split || undefined });
    code = sms.code;
  } else if (fromMail || (codeOnly && item && !hasCode && !sharedHost)) {
    mail = await findEmailCode({ host: staffMailHost || (sideshiftPreview ? "app.sideshift.app" : host), since: Date.now() - 10 * 60_000, length: before.split || undefined });
    code = mail.code;
  } else if ((before.otp || before.split) && hasCode) {
    while (30 - (Math.floor(Date.now() / 1000) % 30) < 5) await new Promise((r) => setTimeout(r, 500));
    code = op(["item", "get", item.id, "--vault", item.vault.id, "--otp"]).trim();
  }
  return { item, username, password, hasCode, code, mail, sms };
}
