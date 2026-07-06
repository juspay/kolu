#!/usr/bin/env bash
# Typing-echo latency baseline — orchestrator.
#
# Boots a PRIVATE, self-contained nix-built kolu (its own kaval, its own state
# dir, a throwaway $HOME, an OS-assigned free port), runs the client probe
# (`typingEchoLatency.ts`) against its `/rpc/ws`, prints/writes the percentiles,
# and tears everything down. Nothing here can touch a production kolu/kaval: the
# private $XDG_RUNTIME_DIR + KOLU_KAVAL_SOCKET means kolu's always-recycle only
# ever reaps ITS OWN kaval.
#
# Run from inside the devshell (for `tsx`):  just bench-typing-echo
# Or directly:  nix develop . -c bash packages/server/bench/run.sh
#
# Env passthrough: any KOLU_BENCH_* var (TERMINALS/SAMPLES/WARMUP/OUT/...) is
# honored by the probe. KOLU_BENCH_BIN=<path/to/bin/kolu> skips the nix build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

KOLU="${KOLU_BENCH_BIN:-}"
if [[ -z "$KOLU" ]]; then
  echo "→ building .#default (nix) ..." >&2
  KOLU="$(nix build .#default --accept-flake-config --no-link --print-out-paths)/bin/kolu"
fi
echo "→ kolu: $KOLU" >&2

RT="$(mktemp -d)"
chmod 700 "$RT"
SERVER_PID=""
cleanup() {
  [[ -n "$SERVER_PID" ]] && kill -TERM "$SERVER_PID" 2>/dev/null || true
  if [[ -f "$RT/kaval/kaval.pid" ]]; then
    kill -KILL "$(cat "$RT/kaval/kaval.pid")" 2>/dev/null || true
  fi
  rm -rf "$RT"
}
trap cleanup EXIT

# Private, isolated server on an OS-assigned free port (--port 0).
env -i \
  HOME="$RT/home" \
  PATH="$PATH" \
  XDG_RUNTIME_DIR="$RT" \
  KOLU_KAVAL_SOCKET="$RT/kaval/pty-host.sock" \
  KOLU_KAVAL_SPAWN=detached \
  "$KOLU" --host 127.0.0.1 --port 0 >"$RT/kolu.log" 2>&1 &
SERVER_PID=$!

echo "→ waiting for the server to listen ..." >&2
PORT=""
for _ in $(seq 1 300); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "server exited early:" >&2
    cat "$RT/kolu.log" >&2
    exit 1
  fi
  if grep -q 'kolu listening' "$RT/kolu.log" 2>/dev/null; then
    PORT="$(grep -oE '127\.0\.0\.1:[0-9]+' "$RT/kolu.log" | head -1 | cut -d: -f2)"
    [[ -n "$PORT" ]] && break
  fi
  sleep 0.2
done
if [[ -z "$PORT" ]]; then
  echo "server never logged 'kolu listening':" >&2
  cat "$RT/kolu.log" >&2
  exit 1
fi
echo "→ server on 127.0.0.1:$PORT" >&2

KOLU_BENCH_HOST=127.0.0.1 KOLU_BENCH_PORT="$PORT" \
  tsx packages/server/bench/typingEchoLatency.ts
