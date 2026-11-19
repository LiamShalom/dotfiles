---
name: agent-login
description: "Sign in to websites with saved 1Password credentials without prompts. Use agent-login-codex.mjs in Codex's in-app browser, or agent-login.mjs in agent Chrome. Supports saved passwords, authenticator codes, emailed codes and texted codes without printing secrets. Use before handing a login to Liam."
---

# Agent login

Liam's logins and two-step codes are in 1Password. This tool signs you in as Liam without
showing you either: it reads the login through a read-only 1Password service account (token in
the login Keychain) and types it straight into your tab. Liam is not asked. The account reads two
vaults: **Agent Logins** (Liam's own logins with two-step codes) and **Agent-Test** (SideShift test
accounts). A login in any other vault is out of reach; only Liam decides what goes into Agent Logins.

When the operator names an existing brand profile, keep that profile as the identity target.
Check its existing grants and saved login before considering signup. A missing or rejected
unrelated QA login is not a reason to replace the requested brand profile with a new account.

## SideShift test accounts in Codex

For SideShift previews or production, use [Codex test login](references/codex-test-login.md) with the business or creator test account. This takes precedence over the Session Board fallback below when running in Codex.

For a SideShift preview, a saved-site mismatch is a login-helper limitation, not a failed
sign-in or a reason to hand it to Liam. If the task needs the staff account, or the Keychain
wrapper is unavailable, use `agent-login-codex-preview.mjs` and its
`loginSideShiftPreviewInCodex(tab, options)` function with the same observed fields and
`item` options as `loginInCodex`. It verifies the deployment in Vercel's `side-shift` team,
then uses the saved `app.sideshift.app` login through the native adapter. Use `SideShift User`
only for staff tasks and `SideShift Test Creator` for creator tasks. No vault website changes
or new approval are needed for an authorized test on that verified preview. An actual
provider refusal still follows the one-failed-sign-in rule.

**The staff account (`SideShift User`, liam@sideshift.app) has two-step verification on
(2026-11-12).** After the password, the app asks for a 6-digit authenticator code: run the
adapter again with the six "Digit n of 6" boxes as `code` (the item holds the code
generator). Emailed login codes and magic links are refused for it. In agent Chrome, open a
preview signed in as staff with `node ~/.claude/bin/agent-signin.mjs --as staff <url>`.
Firebase takes each code once and rate-limits code checks (`QUOTA_EXCEEDED` after about
seven sign-ins in a few minutes), so sign in once and reuse the tab.


## Safari in iOS Simulator

Use `agent-login-safari-simulator.mjs` from `cua_repl` before handing a simulator login to
Liam. It fills one observed username, password or code field from 1Password through the
real native UI. Pass the exact simulator UDID, window name, HTTPS origin, observed mirror
coordinates, item and account. It verifies the local mirror, Safari foreground app, selected
Simulator window and actual expanded Safari URL before loading credentials. It returns only
filled/missing metadata and does not submit. Never fake a browser tab or call the shared
credential resolver directly.

Google: enter the saved password, then use Try another way and Google Authenticator when
offered. Refresh coordinates after Safari expands its browser controls. Submit the filled
code before capturing a screenshot or accessibility tree. A provider refusal still follows
the one-failed-sign-in rule below.

If the task authorizes creating missing test accounts, a missing vault item is not a handoff.
Create the provider account through its real signup UI, keep its unique credentials in
Agent-Test, and verify the finished profile. Record provider security gates separately;
never describe a saved password item alone as a created provider account.

## Find a saved QA login before asking for its name

For a test login whose item name is unknown, run
`node ~/dotfiles/claude/bin/agent-login-discover.mjs https://<site> Agent-Test`.
This lists matching item names, IDs and saved websites only. It does not read usernames,
passwords, codes or item fields. Select the QA item from this result, then use the login
adapter for your browser. Ask for an item name only after this lookup is empty or ambiguous; report
an actual vault-access error separately. Never choose a personal login for a test.
Classify a handle from the saved QA item and a verified test profile or internal test-account record; do not infer personal ownership from its name.

Before the first QA sign-in, match the saved item to its account-creation reference.
Search project memory or references for the item title and public handle. A grant on
the SideShift test user may belong to a different QA account; do not combine that
account's username with this item's password. If the adapter reports a filled
password, it is available: report the observed sign-in failure, not a missing-password
blocker. Keep the one-failed-sign-in handoff rule below.

## Codex in-app browser

For the staff dashboard at `https://sideshifters.vercel.app`, use the saved `SideShift Internal Dashboard` login and `emailCode: true`. The six boxes accept the full code in the first textbox; filling it submits automatically, so use `submit: false`. If its saved login is missing and the operator authorizes saving it, create an email-only Login in Agent Logins before a manual handoff.


Use this path in Codex. Do not open agent Chrome. Reuse the relevant in-app tab, inspect
its current form, then call the adapter from **cua_repl**. The adapter uses the tab's documented
Playwright locators. It reads 1Password locally and passes values directly to those locators.
No credential is returned, printed, written to disk or placed on the clipboard.

```javascript
let login = await import('/Users/liamshalom/.claude/bin/agent-login-codex.mjs');
// tab is your existing cua tab. Use labels from its current state, not guessed selectors.
nodeRepl.write(await login.loginInCodex(tab, {
  item: 'SideShift Test Creator',
  fields: { username: tab.playwright.getByRole('textbox', { name: 'Email Address', exact: true }) },
  submit: true,
}));
await tab.getAXState();
```

Run it at each step. `fields` accepts `username`, `password` and `code` locators. For a
split code, pass an array of the visible digit locators as `code`. Pass `emailCode: true`
only when the page says it emailed a code, and `smsCode: true` only when it says it texted one. `item` can be a saved title or ID; `account`
can select a saved username. Omit them when exactly one saved login matches the site.
For SideShift testing, use `SideShift Test Creator`; use the admin item only for admin tasks.

The result contains only `origin`, `filled`, `missing` and `submitted`. A missing field
prevents submission. Read the next page to confirm sign-in; `submitted: true` only means
Enter was pressed. Do not print or call the shared credential resolver directly. Do not
read filled inputs back. A failed sign-in still requires stopping under the rule below.

The adapter requires HTTPS, checks each field's origin before input and rejects cross-origin
frames. Both browser paths use the same website matching, vault lookup and code helpers.
A missing service token stops with no interactive 1Password fallback. A locked macOS
Keychain or a site's CAPTCHA, passkey or device approval can still need Liam.

Verified 2026-10-30: Codex in-app browser, signed-out SideShift sign-in, saved test creator
email and password, both submissions, authenticated `/home`. No manual input or 1Password prompt.

## Agent Chrome

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
Never retrieve sign-in codes another way, and never print a code or an email.

When Liam authorizes using his email for account recovery, check the connected Gmail
tools or `agent-mail.mjs list/show` before handing recovery back to him. Match the
recipient to the intended test account; a saved item's title alone does not prove that
pairing. Do not print recovery URLs or tokens. Open the verified recovery link in the
task's browser. A new password still requires Liam to enter, confirm and submit it.

## Codes sent by text message

When the page says the site texted a code to Liam's phone, run it with `--sms-code` (add
`--submit`). Liam's iPhone forwards texts to this Mac's Messages app; the tool reads them there
(read-only) and waits up to 2 min for the text, with no prompt. A text's sender cannot be checked,
so it works only on a site with a login saved in 1Password, and takes a code only from a text that
arrived in the last 5 minutes and names the page's site as a word ("Your LinkedIn code is …") or
ends with the site's `@site.com #123456` line. A text that names no site ("Your code is 123456") is
skipped: hand that step to Liam. It refuses customer sites on shared
platforms, SideShift previews included. `node ~/.claude/bin/agent-sms.mjs status` shows whether
Messages can be read and when the last text arrived. "No Full Disk Access" means this session's
terminal lost it (it can after an app update): tell Liam. Never read the Messages database any
other way, and never print a code or a text. Not yet proven on a live sign-in (10-30): on the
first real use, confirm the page signed in, then tell Liam it worked and delete this sentence.

| Exit | Meaning | What to do |
|---|---|---|
| 0 | Filled; it names the fields | Check that the page moved on. |
| 2 | Several logins or tabs match; it lists them | Run again with `--item <id>` or `--account <username>`. If the task does not say which account, ask Liam. |
| 3 | No sign-in field is showing, or 1Password holds no value for it | Bring the field up (close a cookie banner, click "Log in") and run again, or hand the step to Liam. |
| 4 | The service token is missing or Keychain is locked | Report the missing token or locked Keychain. No interactive 1Password fallback is attempted. |
| 1 | Error, for example the login is saved for another site, or no emailed or texted code arrived | Read the message. Never add a website to an item unless Liam says that site is right. On a SideShift preview or local server the script refuses: sign in with `board-browser.mjs` (it signs in a test account), never ask Liam. |

## Rules

- If the operator authorizes continuation after a provider requires its mobile app, inspect
  the available native app or phone mirror before a manual handoff. Keep the same test
  account, do not repeat rejected browser logins, and report the observed device or provider block.
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
  other way, a Google sign-in that Google refuses in this browser, picture puzzles (TikTok), texted
  codes that name no site, sign-in links without authorized inbox access, and OAuth consent.
  A passkey sign-in, or one that needs 1Password's autofill, goes there with
  `node ~/session-board/scripts/board-browser.mjs --1password <https-url> "<what to do>"`: the
  pane's own pages cannot run 1Password, this tab can. When Liam closes it, the sign-in lands in
  this chat's window; open the site with `new_page` and it is signed in.
- An OAuth connect as an account Liam is already signed in to in his own browser (Arc), such as
  another person's Facebook: do not sign that account in here (it sends him a device approval).
  Give him the click-by-click steps for Arc instead, with what to pick on each screen (10-28).
- No prompt does not mean no limits: sign in only where the task needs it, and never use the
  service-account token for anything but this tool. If exit 4 appears, the token is gone; tell
  Liam, do not work around it.
