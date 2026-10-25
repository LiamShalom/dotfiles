---
name: agent-login
description: "Sign in to a website as Liam from the agent browser with a login saved in 1Password: `node ~/.claude/bin/agent-login.mjs` types the username, password and two-step code into your tab after Liam approves the 1Password prompt, and types codes a site emailed to Liam's Gmail (--email-code), and never shows you the values. Use it before you hand a sign-in to Liam, whenever a page in your agent-Chrome tab asks for a username, email, password or authenticator code for one of Liam's accounts or a SideShift test account."
---

# Agent login

Liam's logins and two-step codes are in 1Password. This tool signs you in as Liam without
showing you either: it reads the login through the 1Password app, which asks Liam to approve,
and types it straight into your tab.

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
1Password login for the site has no code generator. It takes a code only from an email sent in
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
| 4 | Waiting for Liam's approval | Tell Liam in chat to approve the 1Password prompt on the Mac, then run it again. |
| 1 | Error, for example the login is saved for another site, or no emailed code arrived | Read the message. Never add a website to an item unless Liam says that site is right. |

## Rules

- Sign in only where the task needs it, to Liam's own accounts or the SideShift test accounts.
  For SideShift testing, use the Agent-Test vault's test accounts. "SideShift User" is a
  platform admin: use it only when the task needs an admin.
- Never read a filled field back, print it or save it, and never pull values out of 1Password
  with `op` yourself. The tool is the only path.
- Most of Liam's 1Password logins hold a username and a two-step code but no password. When the
  tool reports "password (none saved in 1Password)", hand that step to Liam.
- Hand the step to Liam in Session Board's pane when the tool cannot do it: passkeys, a Google
  sign-in that Google refuses in this browser, codes sent by text message, sign-in links sent by
  email (only codes are read), and OAuth consent.
- An approval lasts about 10 minutes. When Liam is away, exit 4 means wait; do not work around it.
