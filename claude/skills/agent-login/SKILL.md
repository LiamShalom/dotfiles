---
name: agent-login
description: "Sign in to a website as Liam from the agent browser with a login saved in 1Password: `node ~/.claude/bin/agent-login.mjs` types the username, password and two-step code into your tab with no prompt (a read-only 1Password service account), and types codes a site emailed to Liam's Gmail (--email-code), and never shows you the values. Use it before you hand a sign-in to Liam, whenever a page in your agent-Chrome tab asks for a username, email, password or authenticator code for one of Liam's accounts or a SideShift test account."
---

# Agent login

Liam's logins and two-step codes are in 1Password. This tool signs you in as Liam without
showing you either: it reads the login through a read-only 1Password service account (token in
the login Keychain) and types it straight into your tab. Liam is not asked. The account reads two
vaults: **Agent Logins** (Liam's own logins with two-step codes) and **Agent-Test** (SideShift test
accounts). A login in any other vault is out of reach; only Liam decides what goes into Agent Logins.

## Run it

1. Open the sign-in page in your own tab (your chat's window in the agent Chrome).
2. Run `node ~/.claude/bin/agent-login.mjs --url <part of the tab's URL> --submit`.
   Pass `--tab <targetId>` instead of `--url` when you know the tab's target id.
3. Look at the page. When a sign-in spans several pages (email, then password, then code),
   run it again at each step.

It uses the 1Password login saved for the tab's site and types only into https pages on that
site, so a login never goes to the wrong site.

## Codes sent by email

When the page says the site emailed a code, run it with `--email-code` (add `--submit`). It
waits up to 90 s for the email in Liam's connected Gmail inboxes and types the code, with no
1Password prompt. It also does this by itself when the page shows only a code box and the
1Password login saved for the site has no code generator. Pass the flag only on the real site you
are signing in to: it refuses customer sites on shared platforms (for example `*.vercel.app`), except SideShift's own previews (`sideshift-*-side-shift.vercel.app`), whose codes come from sideshift.app. It takes a code only from an email sent in
the last 10 minutes, from the same site as the page, that Gmail marked as really from that
sender. `node ~/.claude/bin/agent-mail.mjs status` shows which inboxes are connected. When it
says no inbox is connected or a grant is broken, ask Liam to run
`node ~/.claude/bin/agent-mail.mjs connect` (it opens Google's consent page in his own browser).
Never read the inbox any other way, and never print a code or an email.

| Exit | Meaning | What to do |
|---|---|---|
| 0 | Filled; it names the fields | Check that the page moved on. |
| 2 | Several logins or tabs match; it lists them | Run again with `--item <id>` or `--account <username>`. If the task does not say which account, ask Liam. |
| 3 | No sign-in field is showing, or 1Password holds no value for it | Bring the field up (close a cookie banner, click "Log in") and run again, or hand the step to Liam. |
| 4 | Waiting for Liam's approval (only when the service-account token is missing from the Keychain) | Tell Liam in chat that the token is missing and to approve the 1Password prompt on the Mac, then run it again. |
| 1 | Error, for example the login is saved for another site, or no emailed code arrived | Read the message. Never add a website to an item unless Liam says that site is right. |

## Rules

- **A sign-in fails once: stop and hand it to Liam.** "Incorrect password", a robot check, a
  "confirm it's you" or new-device approval, a locked or rate-limited account: do not retry, do
  not open another context to try again, and do not approve the site's own login prompts from
  another session. Tell Liam what the page says and hand him the page. Retries look like an
  attack to the site and get the account blocked (2026-10-26: five scripted Instagram logins
  locked the new test account).
- Sign in only where the task needs it, to Liam's own accounts or the SideShift test accounts.
  Liam's own social accounts (Instagram, Facebook, TikTok, X, YouTube) are never the account
  under test: don't connect them to a test user or post through them. Use a test account.
  For SideShift testing, use the Agent-Test vault's test accounts. "SideShift User" is a
  platform admin: use it only when the task needs an admin.
- Never read a filled field back, print it or save it, and never pull values out of 1Password
  with `op` yourself. The tool is the only path.
- Most of Liam's 1Password logins hold a username and a two-step code but no password. When the
  tool reports "password (none saved in 1Password)", hand that step to Liam.
- A passkey prompt is not a dead end: click "Try another way" and pick the authenticator option
  (on Google, `[data-challengetype="6"]`, "Get a verification code from the Google Authenticator
  app"), then run the tool again for the code. This gets agents into Google Cloud console, which
  always asks for a passkey (proven 10-28).
- Hand the step to Liam in Session Board's pane when the tool cannot do it: a passkey with no
  other way, a Google sign-in that Google refuses in this browser, picture puzzles (TikTok), codes
  sent by text message, sign-in links sent by email (only codes are read), and OAuth consent.
- An OAuth connect as an account Liam is already signed in to in his own browser (Arc), such as
  another person's Facebook: do not sign that account in here (it sends him a device approval).
  Give him the click-by-click steps for Arc instead, with what to pick on each screen (10-28).
- No prompt does not mean no limits: sign in only where the task needs it, and never use the
  service-account token for anything but this tool. If exit 4 appears, the token is gone; tell
  Liam, do not work around it.
