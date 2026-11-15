#!/usr/bin/env node
// Prints "<uid> <email|-> <test|real|none>" for each uid argument. Used by real-account-signin-gate.sh.
// Exits 1 when the lookup itself cannot run (the gate then fails closed).
import { createRequire } from 'node:module';

const repo = process.env.SIDESHIFT_MONOREPO || '/Users/liamshalom/sideshift-monorepo';
const require = createRequire(`${repo}/package.json`);
const TEST_EMAIL = [
  /@sideshift\.app$/i, // staff and liam+... test logins
  /@mail\.sideshift\.app$/i, // agent-created test brands
  /@example\.(com|org)$/i,
  /^lsdw\.shalom(\+[^@]*)?@gmail\.com$/i, // SideShift Test Creator
  /^testingonboard[^@]*@gmail\.com$/i,
];

try {
  require('dotenv').config({ path: `${repo}/.env.local`, quiet: true });
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)) });
  for (const uid of process.argv.slice(2)) {
    let email = null;
    try {
      email = (await admin.auth().getUser(uid)).email ?? null;
    } catch {
      // Not an auth user (a company or document id that only looks like a uid): nothing to sign in as.
      console.log(`${uid} - none`);
      continue;
    }
    const test = email && TEST_EMAIL.some((re) => re.test(email));
    console.log(`${uid} ${email ?? '-'} ${test ? 'test' : 'real'}`);
  }
  process.exit(0);
} catch (error) {
  console.error(`lookup failed: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
