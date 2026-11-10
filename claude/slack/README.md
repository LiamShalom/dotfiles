# Post to Slack as Liam

The Slack MCP tags every message it sends with "Sent using Claude". To avoid this, agents
send with `~/.claude/bin/slack-as-liam`. It runs `slack api` (the Slack CLI) with Liam's user
token, so the message shows as Liam.

Reading Slack through the MCP is still fine. Every write (messages, files, reactions, canvases)
goes through the CLI. Share a file with `slack-as-liam upload <channel-id> <file> [comment]`.

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
https://api.slack.com/apps?new_app=1&manifest_json=%7B%22display_information%22%3A%7B%22name%22%3A%22Liam%20CLI%22%2C%22description%22%3A%22Lets%20Liam's%20local%20agents%20post%20to%20Slack%20as%20Liam.%22%7D%2C%22oauth_config%22%3A%7B%22scopes%22%3A%7B%22user%22%3A%5B%22chat%3Awrite%22%2C%22reactions%3Awrite%22%2C%22im%3Awrite%22%2C%22users%3Aread%22%2C%22users%3Aread.email%22%2C%22files%3Awrite%22%5D%7D%7D%2C%22settings%22%3A%7B%22org_deploy_enabled%22%3Afalse%2C%22socket_mode_enabled%22%3Afalse%2C%22token_rotation_enabled%22%3Afalse%7D%7D

## Adding a scope later

The app's scopes are in `liam-cli-app.json`. To add one: app settings, **OAuth & Permissions**,
add the user scope, **Reinstall to Workspace**, copy the new User OAuth Token, and store it
again with `security add-generic-password -U -s claude-slack-user-token -a liam -w`.
`files:write` (for `upload`) was added 2026-11-10.

## How agents are kept off the MCP send

`hooks/slack-send-gate.sh` runs before every Slack MCP tool that writes: messages, drafts,
schedules, file uploads, reactions, canvases, lists and new channels. When the Keychain token
exists, it refuses the call and points to `slack-as-liam`. When the
token does not exist, the MCP send still runs.

`slack api` exits 0 even when Slack refuses the call. Check `"ok"` in the JSON it prints.
