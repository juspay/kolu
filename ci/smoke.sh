#!/usr/bin/env bash
# Boot the packaged Kolu (production wrapper) and verify it serves /api/health.
#
# Catches packaging regressions where `nix build` succeeds but the binary
# crashes at runtime — e.g. a missing workspace dep slipping past the build
# (the production crash that motivated #761).

set -euo pipefail

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

# Wait up to 10s for the "kolu listening" event in the log, then extract the
# address from that line. The message text is the semantic anchor — it's what
# the server logs from the listen callback (packages/server/src/index.ts:204)
# and is stable across pino transports (pino-pretty and JSON both preserve it).
addr=""
for _ in $(seq 1 100); do
    if grep -q "kolu listening" "$log" 2>/dev/null; then
        addr=$(grep -oE '"address":"http[^"]*"' "$log" | head -1 | sed -E 's/^"address":"(.*)"$/\1/')
        break
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
        echo "kolu exited before listening" >&2
        cat "$log" >&2
        exit 1
    fi
    sleep 0.1
done

if [[ -z "$addr" ]]; then
    echo "kolu did not log a listen address within 10s" >&2
    cat "$log" >&2
    exit 1
fi
echo "kolu listening at $addr (pid=$pid)"

# Health check via Node's built-in fetch (no curl in dev shell).
resp=$(node -e '
  const url = process.argv[1] + "/api/health";
  fetch(url, { signal: AbortSignal.timeout(5000) })
    .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(t => process.stdout.write(t))
    .catch(e => { console.error(e.message || e); process.exit(1); });
' "$addr")
if [[ "$resp" != "kolu" ]]; then
    echo "unexpected /api/health response: ${resp:-<empty>}" >&2
    cat "$log" >&2
    exit 1
fi
echo "/api/health returned 'kolu'"

# Graceful shutdown: SIGTERM, expect exit 0.
kill -TERM "$pid"
ec=0
wait "$pid" || ec=$?
pid=""
if [[ $ec -ne 0 ]]; then
    echo "kolu exited with code $ec after SIGTERM" >&2
    cat "$log" >&2
    exit 1
fi
echo "shutdown clean"
