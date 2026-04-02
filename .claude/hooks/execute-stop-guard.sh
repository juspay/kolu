#!/usr/bin/env bash
# Prevents Claude from stopping while /execute workflow is still running.
# Reads .execute-results.json and blocks the stop if status == "running".
# Safe default: if the file exists but can't be parsed, block (not approve).
results="$CLAUDE_PROJECT_DIR/.execute-results.json"
if [ ! -f "$results" ]; then
  echo '{"decision":"approve"}'
  exit 0
fi
status=$(jq -r '.status // empty' "$results" 2>/dev/null) || status="parse_error"
case "$status" in
  running)
    echo '{"decision":"block","reason":"Execute workflow still running — continue from where you left off. Check .execute-results.json for current progress."}'
    ;;
  parse_error)
    echo '{"decision":"block","reason":"Could not parse .execute-results.json — file may be corrupted. Check and fix it before stopping."}'
    ;;
  *)
    echo '{"decision":"approve"}'
    ;;
esac
