# SideShift test login in Codex

For SideShift previews and production, keep the native in-app tab. Use the same
Keychain test accounts as Session Board through the native sign-in form.
The helper verifies preview ownership with Vercel before reading credentials.
Use `brand` for business screens such as Ads, or `creator` for creator screens.

```javascript
var testLogin = await import('/Users/liamshalom/dotfiles/claude/bin/agent-login-codex-test.mjs');
nodeRepl.write(await testLogin.loginSideShiftTestInCodex(tab, {
  role: 'brand',
  fields: { username: tab.playwright.getByRole('textbox', { name: 'Email Address', exact: true }) },
  submit: true,
}));
await tab.getAXState();
```

On the password step, call it with `fields.password` using the observed password
locator. A submitted form is not proof of sign-in. Confirm the destination page.
Never read filled fields back. The helper returns only field names and status.
It does not change vault websites, inject sessions, or open another browser.

If Keychain credentials are missing or locked, report that blocker. A provider
refusal still follows the skill's one-failed-sign-in rule.
