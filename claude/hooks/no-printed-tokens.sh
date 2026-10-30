#!/bin/bash
# Refuses a Bash call that prints a Google access or identity token to the transcript.
# Capturing one inside $(...) for another command is allowed.
cmd=$(jq -r '.tool_input.command // ""')
if ! printf '%s' "$cmd" | grep -Eq 'print-(access|identity)-token'; then
  exit 0
fi
if printf '%s' "$cmd" | grep -Eq '\$\([^)]*print-(access|identity)-token'; then
  exit 0
fi
echo "Blocked: this prints a live Google token into the transcript. Capture it inside \$(...) for the command that needs it, or check identity with 'gcloud auth list' / 'gcloud config get account'." >&2
exit 2
