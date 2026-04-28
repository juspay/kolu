#!/usr/bin/env bash
# Boot the packaged Kolu (production wrapper) and verify it serves /api/health.
#
# Catches packaging regressions where `nix build` succeeds but the binary
# crashes at runtime — e.g. a missing workspace dep slipping past the build
# (the production crash that motivated #761).

set -euo pipefail

readonly LISTEN_TIMEOUT_SEC=10
readonly POLL_INTERVAL_SEC=0.1
readonly HEALTH_TIMEOUT_MS=5000

KOLU=$(nix build .#default --no-link --print-out-paths)/bin/kolu

tmp=$(mktemp -d)
log="$tmp/kolu.log"
pid=""

cleanup() {
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill -TERM "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
    fi
    rm -rf "$tmp"
}
trap cleanup EXIT

# Sanitize env so we mirror production: clear IN_NIX_SHELL and devshell
# pollution. HOME→tmp so the wrapper's KOLU_STATE_DIR lands there instead of
# the runner's real ~/.config.
env -i HOME="$tmp" "$KOLU" --host 127.0.0.1 --port 0 >"$log" 2>&1 &
pid=$!

# Wait for the "kolu listening" event in the log, then extract the address
# from that line. The message text is the semantic anchor — it's what the
# server logs from the listen callback (packages/server/src/index.ts:204) and
# is stable across pino transports (pino-pretty and JSON both preserve it).
addr=""
ticks=$(awk "BEGIN { print int($LISTEN_TIMEOUT_SEC / $POLL_INTERVAL_SEC) }")
for _ in $(seq 1 "$ticks"); do
    if grep -q "kolu listening" "$log" 2>/dev/null; then
        # `|| true` keeps an empty match from tripping pipefail+set-e silently;
        # the [[ -z "$addr" ]] check below produces a clear diagnostic.
        addr=$(grep -oE '"address":"http[^"]*"' "$log" | head -1 | sed -E 's/^"address":"(.*)"$/\1/' || true)
        break
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
        echo "kolu exited before listening" >&2
        cat "$log" >&2
        exit 1
    fi
    sleep "$POLL_INTERVAL_SEC"
done

if [[ -z "$addr" ]]; then
    if grep -q "kolu listening" "$log" 2>/dev/null; then
        echo "kolu logged 'listening' but no address could be parsed from the line" >&2
    else
        echo "kolu did not log a listen address within ${LISTEN_TIMEOUT_SEC}s" >&2
    fi
    cat "$log" >&2
    exit 1
fi
echo "kolu listening at $addr (pid=$pid)"

# Health check via Node's built-in fetch (no curl in dev shell). Asserts only
# HTTP 200 — the response body is an implementation detail of index.ts:143
# that the smoke shouldn't couple to.
node -e '
  const [url, timeoutMs] = [process.argv[1] + "/api/health", Number(process.argv[2])];
  fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
    .catch(e => { console.error(e.message || e); process.exit(1); });
' "$addr" "$HEALTH_TIMEOUT_MS"
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
