#!/bin/bash
# Refuses a Bash call that prints a Google access or identity token to the transcript.
# A token captured inside $(...) and passed to a command that does not print it is allowed.
# Fails closed: any token call left after removing those captures is blocked.
cmd=$(jq -r '.tool_input.command // ""')
token='print-(access|identity)-token'
if ! printf '%s' "$cmd" | grep -Eq "$token"; then
  exit 0
fi
block() {
  echo "Blocked: this prints a live Google token into the transcript. Capture it inside \$(...) for the command that needs it (for example curl -H \"Authorization: Bearer \$(gcloud auth print-access-token)\"), or check identity with 'gcloud auth list'." >&2
  exit 2
}
# Only a capture used directly as a Bearer header is allowed. A capture kept in a variable
# or handed to another command can still be printed later in the same call.
rest=$(printf '%s' "$cmd" | sed -E "s/Bearer[[:space:]]+\\\$\([^)]*$token[^)]*\)//g")
if printf '%s' "$rest" | grep -Eq "$token"; then
  block
fi
exit 0
