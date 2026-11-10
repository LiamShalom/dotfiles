# Post to Slack as Liam

The Slack MCP tags every message it sends with "Sent using Claude". To avoid this, agents
send with `~/.claude/bin/slack-as-liam`. It runs `slack api` (the Slack CLI) with Liam's user
token, so the message shows as Liam.

Reading Slack through the MCP is still fine. Only sending is affected.

## Setup (one time, Liam)

1. Create the app from the manifest: open the "Create app" link below, pick the SideShift
   workspace, then click Create. The manifest is `liam-cli-app.json` in this folder.
2. In the app's settings, open **OAuth & Permissions** and click **Install to Workspace**.
3. Copy the **User OAuth Token** (it starts with `xoxp-`).
4. Store it in Keychain. Run this in a terminal and paste the token at the prompt:

   ```sh
   security add-generic-password -s claude-slack-user-token -a liam -w
   ```

5. Check it: `~/.claude/bin/slack-as-liam auth.test` prints `"ok":true`.

Create app link (manifest prefilled):
https://api.slack.com/apps?new_app=1&manifest_json=%7B%22display_information%22%3A%7B%22name%22%3A%22Liam%20CLI%22%2C%22description%22%3A%22Lets%20Liam%27s%20local%20agents%20post%20to%20Slack%20as%20Liam%2C%20and%20starts%20Session%20Board%20triage%20chats.%22%7D%2C%22features%22%3A%7B%22bot_user%22%3A%7B%22display_name%22%3A%22Liam%20CLI%22%2C%22always_online%22%3Afalse%7D%2C%22shortcuts%22%3A%5B%7B%22name%22%3A%22Triage%20in%20Session%20Board%22%2C%22type%22%3A%22message%22%2C%22callback_id%22%3A%22triage_message%22%2C%22description%22%3A%22Start%20a%20Session%20Board%20chat%20that%20investigates%20this%20message%22%7D%5D%2C%22slash_commands%22%3A%5B%7B%22command%22%3A%22%2Ftriage%22%2C%22description%22%3A%22Start%20a%20Session%20Board%20chat%20that%20investigates%20a%20Slack%20message%22%2C%22usage_hint%22%3A%22%3Cmessage%20link%3E%20%5Bnote%5D%22%2C%22should_escape%22%3Afalse%7D%5D%7D%2C%22oauth_config%22%3A%7B%22scopes%22%3A%7B%22user%22%3A%5B%22chat%3Awrite%22%2C%22reactions%3Awrite%22%2C%22im%3Awrite%22%2C%22users%3Aread%22%2C%22users%3Aread.email%22%5D%2C%22bot%22%3A%5B%22commands%22%5D%7D%7D%2C%22settings%22%3A%7B%22interactivity%22%3A%7B%22is_enabled%22%3Atrue%7D%2C%22org_deploy_enabled%22%3Afalse%2C%22socket_mode_enabled%22%3Atrue%2C%22token_rotation_enabled%22%3Afalse%7D%7D

## How agents are kept off the MCP send

`hooks/slack-send-gate.sh` runs before `slack_send_message` and `slack_schedule_message`.
When the Keychain token exists, it refuses the call and points to `slack-as-liam`. When the
token does not exist, the MCP send still runs.

`slack api` exits 0 even when Slack refuses the call. Check `"ok"` in the JSON it prints.

## Triage from Slack (Session Board)

The same app gives you a message shortcut, **⋯ → Triage in Session Board**, and
`/triage <message link> [note]`. Either one starts a background chat in `~/sideshift-monorepo`
on Session Board that runs `/investigate-slack-issue` on the message. The chat opens a draft PR for
a code fix (never merges), writes no production data, leaves a draft reply in the thread, and DMs
you the result. Only the owner of the user token can run it. Session Board must be running on an
awake Mac: it holds the Socket Mode connection.

Setup (one time, Liam):

1. In the app's settings, open **App Manifest**, paste `liam-cli-app.json`, and save.
2. Click **Reinstall to Workspace** when Slack asks (the manifest adds the `commands` scope).
3. Open **Basic Information → App-Level Tokens → Generate Token and Scopes**, add the
   `connections:write` scope, and copy the token (it starts with `xapp-`).
4. Store it in Keychain and paste the token at the prompt:

   ```sh
   security add-generic-password -s claude-slack-app-token -a liam -w
   ```

5. Quit and reopen Session Board. Its log shows `[slack-triage] listening for /triage`.

