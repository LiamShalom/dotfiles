#!/usr/bin/env bash
# Replays the 2026-11-14 Triips incident against real-account-signin-gate.sh, plus cases it must allow.
# Uses a stub lookup; pass --live to also run the real Firebase lookup on the Triips owner's uid.
dir="$(cd "$(dirname "$0")" && pwd)"
hook="$dir/real-account-signin-gate.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export REAL_ACCOUNT_LOCK_DIR="$tmp/locks"
TRIIPS=0rzIdV9gf6RzLGK1YvcOWweWchb2
TEST_BRAND=lQDzvcQWJCZRZ12Ks0zpWTzv9xx1
LIVFRESH=DtdKvhqyKz2skNii87zC # a real client with a 20-character uid
cat >"$tmp/lookup.sh" <<EOF
#!/usr/bin/env bash
for u in "\$@"; do
  case "\$u" in
    $TRIIPS) echo "\$u omar@triips.com real" ;;
    $TEST_BRAND) echo "\$u liam+devtesting@sideshift.app test" ;;
    $LIVFRESH) echo "\$u - real" ;;
    *) echo "\$u - none" ;;
  esac
done
EOF
chmod +x "$tmp/lookup.sh"
export REAL_ACCOUNT_LOOKUP="$tmp/lookup.sh"

# The incident's seed script, verbatim in substance.
cat >"$tmp/seed.mjs" <<'EOF'
const admin = require('firebase-admin');
const uid = process.argv[2];
const custom = await admin.auth().createCustomToken(uid);
const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, { method: 'POST' });
EOF

fail=0
expect() { # expect <deny|allow> <label> <json>
  out=$(printf '%s' "$3" | bash "$hook" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)
  got=${out:-allow}
  if [ "$got" = "$1" ]; then echo "ok   $2"; else echo "FAIL $2 (got $got)"; fail=1; fi
}
bash_json() { jq -nc --arg c "$1" --arg s "${2:-s1}" --arg d "$tmp" '{tool_name:"Bash",session_id:$s,cwd:$d,tool_input:{command:$c}}'; }
nav_json() { jq -nc --arg u "$1" --arg s "${2:-s1}" '{tool_name:"mcp__chrome-devtools__navigate_page",session_id:$s,tool_input:{type:"url",url:$u}}'; }

expect deny  'the 11-14 command: node seed.mjs <Triips uid> (relative path)' "$(bash_json "node seed.mjs $TRIIPS perfc=bigbrand")"
expect deny  'same with absolute path' "$(bash_json "node $tmp/seed.mjs $TRIIPS perfc=bigbrand")"
expect deny  'inline heredoc mint for Triips' "$(bash_json "node - <<'EOF'
await admin.auth().createCustomToken('$TRIIPS')
EOF")"
expect deny  'move-campaign mint-id-token for a real uid' "$(bash_json "npx tsx --env-file=.env.local .claude/skills/move-campaign/scripts/mint-id-token.ts $TRIIPS")"
expect deny  'override does not cover a preview URL' "$(bash_json "SIDESHIFT_REAL_ACCOUNT_OK=1 node seed.mjs $TRIIPS https://sideshift-web-git-feat-x-side-shift.vercel.app/messages")"
expect deny  'real client with a 20-character uid (LIVFRESH)' "$(bash_json "node seed.mjs $LIVFRESH")"
expect deny  'python mint' "$(bash_json "python3 - <<'EOF'
from firebase_admin import auth
auth.create_custom_token('$TRIIPS')
EOF")"
expect allow 'override with the agent Chrome DevTools address (prod repro)' "$(bash_json "SIDESHIFT_REAL_ACCOUNT_OK=1 node seed.mjs $TRIIPS http://127.0.0.1:9222" s4)"
expect allow 'mint for the test brand' "$(bash_json "node seed.mjs $TEST_BRAND")"
expect allow 'mint with no uid literal (test token from env)' "$(bash_json "node scripts/mint-test-token.mjs")"
expect allow 'uid in an unrelated command' "$(bash_json "grep -rn $TRIIPS lib/")"
expect allow 'unrelated command' "$(bash_json "gh pr checks 8925")"
expect allow 'navigate to a preview without a real session' "$(nav_json https://sideshift-web-git-feat-x-side-shift.vercel.app/messages s2)"
expect allow 'override for a prod repro Liam asked for' "$(bash_json "SIDESHIFT_REAL_ACCOUNT_OK=1 node seed.mjs $TRIIPS" s3)"
expect deny  '...then that session opens a preview' "$(nav_json https://sideshift-web-git-feat-messaging-spaces-side-shift.vercel.app/messages s3)"
expect deny  '...or a local server' "$(nav_json http://localhost:3000/messages s3)"
expect deny  '...or reloads (could be a preview tab)' "$(jq -nc '{tool_name:"mcp__chrome-devtools__navigate_page",session_id:"s3",tool_input:{type:"reload"}}')"
expect deny  '...or a lookalike host' "$(nav_json https://app.sideshift.app.evil.example/x s3)"
expect deny  '...or a preview on a custom domain' "$(nav_json https://staging.sideshift.app/messages s3)"
expect deny  '...or a preview hidden behind a newline' "$(nav_json $'https://sideshift-web-git-x.vercel.app/m\nhttps://app.sideshift.app/' s3)"
expect allow '...but production is fine' "$(nav_json https://app.sideshift.app/messages s3)"

if [ "${1:-}" = "--live" ]; then
  unset REAL_ACCOUNT_LOOKUP
  expect deny 'LIVE lookup: Triips owner is real' "$(bash_json "node seed.mjs $TRIIPS" live)"
  expect allow 'LIVE lookup: Dev Testing Liam is a test account' "$(bash_json "node seed.mjs $TEST_BRAND" live)"
  # The preload, which catches mints the text check cannot see (uid read from a file, in an imported module).
  # createCustomToken only signs locally; nothing is sent.
  printf '%s\n%s\n%s\n' "$TRIIPS" "$LIVFRESH" "$TEST_BRAND" >"$tmp/uids.txt"
  cat >"$tmp/lib.mjs" <<'EOF'
import { createRequire } from 'node:module';
const require = createRequire('/Users/liamshalom/sideshift-monorepo/package.json');
require('dotenv').config({ path: '/Users/liamshalom/sideshift-monorepo/.env.local', quiet: true });
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)) });
export const tryMint = (uid) => admin.auth().createCustomToken(uid).then(() => 'minted', () => 'refused');
EOF
  cat >"$tmp/run.mjs" <<'EOF'
import { readFileSync } from 'node:fs';
import { tryMint } from './lib.mjs';
const out = [];
for (const uid of readFileSync(new URL('./uids.txt', import.meta.url), 'utf8').trim().split('\n')) out.push(await tryMint(uid));
console.log(out.join(' '));
process.exit(0);
EOF
  guard="--require=$dir/firebase-mint-guard.cjs"
  got=$(NODE_OPTIONS="$guard" node "$tmp/run.mjs")
  [ "$got" = "refused refused minted" ] && echo "ok   LIVE preload: node refuses Triips + LIVFRESH, mints test brand" || { echo "FAIL LIVE preload node ($got)"; fail=1; }
  got=$(NODE_OPTIONS="$guard" /Users/liamshalom/sideshift-monorepo/node_modules/.bin/tsx "$tmp/run.mjs")
  [ "$got" = "refused refused minted" ] && echo "ok   LIVE preload: tsx too" || { echo "FAIL LIVE preload tsx ($got)"; fail=1; }
  printf '%s\n' "process.env.SIDESHIFT_REAL_ACCOUNT_OK = '1';" "await import('./run.mjs');" >"$tmp/self-override.mjs"
  got=$(NODE_OPTIONS="$guard" node "$tmp/self-override.mjs")
  [ "$got" = "refused refused minted" ] && echo "ok   LIVE preload: a script cannot set the override for itself" || { echo "FAIL LIVE self-override ($got)"; fail=1; }
  got=$(node "$tmp/run.mjs")
  [ "$got" = "minted minted minted" ] && echo "ok   LIVE control: without the preload all three mint" || { echo "FAIL LIVE control ($got)"; fail=1; }
fi
exit $fail
