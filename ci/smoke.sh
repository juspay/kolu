#!/usr/bin/env bash
# Boot the packaged Kolu (production wrapper, .#default) and verify the two
# runtime contracts a green `nix build` can still break:
#
#   1. It serves /api/health — catches packaging regressions where the build
#      succeeds but the binary crashes at startup (the missing-workspace-dep
#      crash that motivated #761).
#   2. It HONORS an inherited KOLU_STATE_DIR — #531 made default.nix export it
#      unconditionally, silently forcing state under $HOME/.config/kolu so a
#      second production instance couldn't relocate its state (juspay/kolu#1414).
#
# Both contracts are exercised the same way — boot the wrapper on an ephemeral
# port, poll its log for a marker line, read a field off it — so that shared
# mechanism lives in wait_for_marker + json_field; each contract is the thin
# remainder (which env, which marker, which assertion).

set -euo pipefail

readonly MARKER_TIMEOUT_SEC=10
readonly POLL_INTERVAL_SEC=0.1
readonly HEALTH_TIMEOUT_MS=5000
readonly TICKS=$(awk "BEGIN { print int($MARKER_TIMEOUT_SEC / $POLL_INTERVAL_SEC) }")

KOLU=$(nix build .#default --no-link --print-out-paths)/bin/kolu

tmp=$(mktemp -d)
log="$tmp/kolu.log"
state_tmp=""
pid=""
state_pid=""

cleanup() {
    # Best-effort teardown on EXIT — `|| true` because the trap can race with
    # the process's own exit, and we don't want a stale-PID kill to mask the
    # real error that triggered the trap.
    for p in "$pid" "$state_pid"; do
        if [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null; then
            kill -TERM "$p" 2>/dev/null || true
            wait "$p" 2>/dev/null || true
        fi
    done
    rm -rf "$tmp" ${state_tmp:+"$state_tmp"}
}
trap cleanup EXIT

# Block until $proc logs $marker, dies, or the timeout elapses; the last two are
# smoke failures (dump the log, abort). The marker is the message TEXT — the
# semantic anchor, stable across pino transports (pino-pretty and JSON alike).
wait_for_marker() {
    local marker=$1 logfile=$2 proc=$3
    for _ in $(seq 1 "$TICKS"); do
        grep -q "$marker" "$logfile" 2>/dev/null && return 0
        if ! kill -0 "$proc" 2>/dev/null; then
            echo "kolu exited before logging: $marker" >&2
            cat "$logfile" >&2
            exit 1
        fi
        sleep "$POLL_INTERVAL_SEC"
    done
    echo "kolu did not log '$marker' within ${MARKER_TIMEOUT_SEC}s" >&2
    cat "$logfile" >&2
    exit 1
}

# Value of the JSON string field "<name>":"<value>" on the line carrying $marker
# ("" if none). Scoping to the marker line — the same anchor the probe already
# waited on — keeps this honest: the field is read off the line whose presence we
# proved, not the first match anywhere (which would silently capture an unrelated
# earlier "<name>":"..." if a future log line emitted one).
# NAME is a fixed prefix (grep -F + literal ${match#...} strip), not a regex, so
# it carries no pattern sensitivity; both callers pass static literals regardless.
# The values read here (a URL, a path) never contain a quote, so the next " ends
# the field exactly.
json_field() {
    local name=$1 file=$2 marker=$3 match
    match=$(grep -F "$marker" "$file" | grep -oE "\"$name\":\"[^\"]*\"" | head -1 || true)
    match=${match#\"$name\":\"}
    printf '%s' "${match%\"}"
}

# --- Contract 1: the binary boots and serves /api/health. ---
# Sanitize env so we mirror production: clear IN_NIX_SHELL and devshell
# pollution. HOME→tmp so the wrapper's default KOLU_STATE_DIR lands there
# instead of the runner's real ~/.config.
env -i HOME="$tmp" "$KOLU" --host 127.0.0.1 --port 0 >"$log" 2>&1 &
pid=$!

# The address is logged from the listen callback (packages/server/src/index.ts).
wait_for_marker "kolu listening" "$log" "$pid"
addr=$(json_field address "$log" "kolu listening")
if [[ -z "$addr" ]]; then
    echo "kolu logged 'listening' but no address could be parsed from the line" >&2
    cat "$log" >&2
    exit 1
fi
echo "kolu listening at $addr (pid=$pid)"

# Health check via Node's built-in fetch (no curl in dev shell). Asserts only
# HTTP 200 — the response body is an implementation detail of index.ts:143
# that the smoke shouldn't couple to.
if ! node -e '
  const [url, timeoutMs] = [process.argv[1] + "/api/health", Number(process.argv[2])];
  fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
    .catch(e => { console.error(e.message || e); process.exit(1); });
' "$addr" "$HEALTH_TIMEOUT_MS"; then
    echo "/api/health request failed" >&2
    cat "$log" >&2
    exit 1
fi
echo "/api/health returned 200"

# Graceful shutdown: SIGTERM, expect exit 0.
kill -TERM "$pid"
ec=0
wait "$pid" || ec=$?
pid=""  # disarm cleanup trap — we've already waited
if [[ $ec -ne 0 ]]; then
    echo "kolu exited with code $ec after SIGTERM" >&2
    cat "$log" >&2
    exit 1
fi
echo "shutdown clean"

# --- Contract 2: the production wrapper HONORS an inherited KOLU_STATE_DIR. ---
# Boot with KOLU_STATE_DIR pointed at a dir OUTSIDE $HOME and assert the server
# resolves that exact directory (state.ts logs it at startup). This guard lives
# on .#default deliberately: .#koluBin has no fallback and crashes if the var is
# unset — that's what tests build, so they never traverse this wrapper, and #530
# /#531's test-isolation guarantee is untouched.
state_tmp=$(mktemp -d)
# Resolve symlinks up front: the server echoes back the KOLU_STATE_DIR we pass
# verbatim, so we compare against the canonical form to stay robust on the darwin
# lane (macOS $TMPDIR / `/tmp` resolve under /private) — and against a future
# change that logs the resolved path rather than the raw env value.
custom_state="$(realpath "$state_tmp")/relocated"
state_log="$state_tmp/kolu.log"
env -i HOME="$state_tmp/home" KOLU_STATE_DIR="$custom_state" \
    "$KOLU" --host 127.0.0.1 --port 0 >"$state_log" 2>&1 &
state_pid=$!

wait_for_marker "state directory" "$state_log" "$state_pid"
logged=$(json_field path "$state_log" "state directory")
# Best-effort teardown (same rationale as cleanup()): a stale-PID kill can race
# the process's own exit, and that error must not mask a real failure.
kill -TERM "$state_pid" 2>/dev/null || true
wait "$state_pid" 2>/dev/null || true
state_pid=""  # disarm cleanup trap — we've already waited

if [[ "$logged" != "$custom_state" ]]; then
    echo "production wrapper ignored KOLU_STATE_DIR (juspay/kolu#1414):" >&2
    echo "  set:    KOLU_STATE_DIR=$custom_state" >&2
    echo "  logged: state directory = ${logged:-<none>}" >&2
    cat "$state_log" >&2
    exit 1
fi
echo "KOLU_STATE_DIR honored: $logged"
