#!/bin/bash
# SessionStart hook: gcloud org policy expires credentials every ~16h.
# Checks CLI + ADC tokens; auto-launches the browser login for whichever is expired.
# stdout is injected into Claude's context — stay silent when auth is valid.

GCLOUD="${GCLOUD_BIN:-/opt/homebrew/bin/gcloud}"
[ -x "$GCLOUD" ] || GCLOUD=$(command -v gcloud) || exit 0

if ! "$GCLOUD" auth print-access-token >/dev/null 2>&1; then
  echo "gcloud CLI credential expired — opening browser: gcloud auth login --update-adc (refreshes CLI + ADC)"
  if "$GCLOUD" auth login --update-adc --brief --quiet >/dev/null 2>&1; then
    echo "gcloud auth refreshed — CLI and ADC are both valid again."
  else
    echo "AUTO-LOGIN FAILED or timed out. gcloud auth is still expired — ask the user to run: ! gcloud auth login --update-adc"
  fi
elif ! "$GCLOUD" auth application-default print-access-token >/dev/null 2>&1; then
  # gcloud auth login skips the flow when the CLI credential is still valid,
  # so an ADC-only expiry needs the dedicated ADC login.
  echo "gcloud ADC expired (CLI credential still valid) — opening browser: gcloud auth application-default login"
  if "$GCLOUD" auth application-default login --quiet >/dev/null 2>&1; then
    echo "gcloud ADC refreshed."
  else
    echo "AUTO-LOGIN FAILED or timed out. ADC is still expired — ask the user to run: ! gcloud auth application-default login"
  fi
fi
exit 0
