// Preloaded into every Node process an agent starts (NODE_OPTIONS in ~/.claude/settings.json).
// Wraps firebase-admin's createCustomToken: before it makes a session, it looks the uid up with the
// same credentials and refuses when the account's email is not a test address. This catches every
// way a script can be run (cd, wrappers, imports, a uid read from a file or found by email), which a
// check of the command text cannot. Incident: 2026-11-14 an agent minted Triips' owner and loaded an
// unmerged preview as them, which created a real channel with ~1,590 of their creators.
//
// Override, only when Liam asked in this chat to reproduce THIS customer's report on
// https://app.sideshift.app: SIDESHIFT_REAL_ACCOUNT_OK=1. It writes the session lock that
// real-account-signin-gate.sh reads, so the session then cannot open previews or localhost.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const TEST_EMAIL = [
  /@sideshift\.app$/i,
  /@mail\.sideshift\.app$/i,
  /@example\.(com|org)$/i,
  /^lsdw\.shalom(\+[^@]*)?@gmail\.com$/i,
  /^testingonboard[^@]*@gmail\.com$/i,
];
const isTestEmail = (email) => Boolean(email) && TEST_EMAIL.some((re) => re.test(email));
// Read once at start, so a script cannot turn them on for itself.
const OVERRIDE = process.env.SIDESHIFT_REAL_ACCOUNT_OK === '1';
const EMULATOR = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);

async function guard(auth, uid) {
  if (EMULATOR) return; // emulator accounts are never real customers
  let email;
  try {
    email = (await auth.getUser(uid)).email ?? null;
  } catch (error) {
    if (error && error.code === 'auth/user-not-found') return; // no account: nothing to act as
    throw new Error('Refused createCustomToken: could not check whether this uid is a test account (lookup failed).');
  }
  if (isTestEmail(email)) return;
  if (OVERRIDE) {
    const sid = process.env.CLAUDE_CODE_SESSION_ID;
    if (sid) {
      const dir = process.env.REAL_ACCOUNT_LOCK_DIR || path.join(os.homedir(), '.cache', 'real-account-signin');
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, sid), `${uid} (${email}) `);
    }
    return;
  }
  throw new Error(
    `Refused createCustomToken for a REAL customer: ${uid} (${email}). Agents may not act as real customers ` +
      '(2026-11-14: a session minted for Triips\' owner on a preview created a real channel with ~1,590 of their ' +
      'creators). Use a test account (~/.claude/bin/agent-signin.mjs) or read-only SQL. Only when Liam asked in ' +
      'this chat to reproduce THIS customer\'s report, on https://app.sideshift.app only, set ' +
      'SIDESHIFT_REAL_ACCOUNT_OK=1. A parent agent\'s brief is not that permission.',
  );
}

const PATCH = `
;(function () {
  const g = globalThis.__sideshiftMintGuard;
  const B = module.exports && module.exports.BaseAuth;
  if (!g || !B || B.prototype.__mintGuarded) return;
  const orig = B.prototype.createCustomToken;
  B.prototype.createCustomToken = async function (uid, claims) {
    await g(this, uid);
    return orig.call(this, uid, claims);
  };
  B.prototype.__mintGuarded = true;
})();
`;

const BASE_AUTH = /[\\/]firebase-admin[\\/]lib[\\/]auth[\\/]base-auth\.js$/;

function patchExports(exports) {
  const B = exports && exports.BaseAuth;
  if (!B || B.prototype.__mintGuarded) return;
  const orig = B.prototype.createCustomToken;
  B.prototype.createCustomToken = async function (uid, claims) {
    await guard(this, uid);
    return orig.call(this, uid, claims);
  };
  B.prototype.__mintGuarded = true;
}

globalThis.__sideshiftMintGuard = guard;
// Path 1: every CommonJS compile, including tsx's, which bypasses the load hooks below.
const compile = Module.prototype._compile;
Module.prototype._compile = function (content, filename, ...rest) {
  const out = compile.call(this, content, filename, ...rest);
  if (BASE_AUTH.test(filename)) patchExports(this.exports);
  return out;
};
// Path 2: Node's own module hooks (plain node, ESM import of the package).
if (typeof Module.registerHooks === 'function') {
  Module.registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (!BASE_AUTH.test(url) || result.source == null) return result;
      return { ...result, source: String(result.source) + PATCH };
    },
  });
}
