#!/usr/bin/env bash
# Coordinator-only: refuse to end a turn while the orchestrator dashboard is
# stale. The board (orchestrator-data.js in the coordinator's PWD) must be
# updated same-turn as every board event; memory demonstrably fails at this
# (the human had to ask twice in one day), so the harness enforces it.
# Non-coordinator sessions have no orchestrator-data.js and exit instantly.
# Output contract (cross-compatible, mirrors do-stop-guard): emit ONLY
# {"decision":"block","reason":"…"} to block; empty stdout to allow.
board="$CLAUDE_PROJECT_DIR/orchestrator-data.js"
if [ ! -f "$board" ]; then
  exit 0
fi
# Avoid infinite block loops: if this stop already follows a block, allow.
input=$(cat 2>/dev/null || true)
if printf '%s' "$input" | jq -e '.stop_hook_active == true' >/dev/null 2>&1; then
  exit 0
fi
now=$(date +%s)
mtime=$(stat -c %Y "$board" 2>/dev/null || stat -f %m "$board" 2>/dev/null) || exit 0
age=$(( now - mtime ))
# 45 minutes: long enough for a quiet gate-wait, short enough that a merge,
# stand-down, dispatch, or lane-state change cannot slip a whole turn behind.
if [ "$age" -gt 2700 ]; then
  mins=$(( age / 60 ))
  printf '{"decision":"block","reason":"The orchestrator dashboard (orchestrator-data.js) is %s minutes stale. Update it for any board events this turn (merges, stand-downs, dispatches, lane-state changes) before ending the turn — or touch it if genuinely nothing changed."}\n' "$mins"
fi
exit 0
