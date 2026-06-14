#!/usr/bin/env bash
# Drive driver.cjs against a running dev kolu and print the per-event work table
# (burst time / per-event µs / tile writes / frames-blocked) across CPU throttle.
#
# The driver uses a BURST microbenchmark (K WheelEvents dispatched from page JS
# in a tight loop), which measures per-event main-thread cost independent of the
# frame-scheduler — so plain `--headless=new` is fine and faithful here (no need
# for a real display: the burst never relies on rAF cadence). See driver.cjs.
#
# Dependency-free driver (CDP over Node's built-in WebSocket). Externals:
#   - dev server: `just dev-auto` (NEVER `just dev`); pass its client URL as $1,
#     or it reads .dev-server/ports.json.
#   - Chrome: nix-built playwright chromium, or ~/.cache/ms-playwright.
#
#   bash run.sh [clientUrl] [nTiles=16] [burst=60]
set -euo pipefail
cd "$(dirname "$0")"

URL="${1:-}"
if [[ -z "$URL" ]]; then
  PORTS="$(git rev-parse --show-toplevel)/.dev-server/ports.json"
  [[ -f "$PORTS" ]] && URL="$(node -e "process.stdout.write(require('$PORTS').client)")"
fi
[[ -z "$URL" ]] && { echo "usage: bash run.sh <clientUrl> [nTiles] [burst]  (or start 'just dev-auto' first)"; exit 1; }
N_TILES="${2:-16}"; BURST="${3:-60}"; PORT=9531

CHROME=""
if BROWSERS="$(nix build --no-link --print-out-paths nixpkgs#playwright-driver.browsers 2>/dev/null)"; then
  for c in "$BROWSERS"/chromium-*/chrome-linux/chrome "$BROWSERS"/chromium-*/chrome-linux64/chrome; do
    [[ -x "$c" ]] && CHROME="$c" && break
  done
fi
if [[ -z "$CHROME" ]]; then
  for c in "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome; do
    [[ -x "$c" ]] && CHROME="$c" && break
  done
fi
[[ -z "$CHROME" ]] && { echo "no chromium found (nix playwright-driver.browsers or ~/.cache/ms-playwright)"; exit 1; }

UDD="$(mktemp -d)"
"$CHROME" --headless=new --no-sandbox --disable-dev-shm-usage \
  --remote-debugging-port=$PORT --remote-allow-origins='*' --user-data-dir="$UDD" \
  --window-size=1600,1000 --force-device-scale-factor=1 --no-first-run \
  --disable-renderer-backgrounding about:blank >chrome.log 2>&1 &
CPID=$!
cleanup() { kill "$CPID" 2>/dev/null || true; wait "$CPID" 2>/dev/null || true; rm -rf "$UDD"; }
trap cleanup EXIT
for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break; sleep 0.2; done

echo "Chrome: $CHROME"
echo "URL:    $URL   tiles=$N_TILES burst=$BURST"
node driver.cjs "$URL" "$PORT" "$N_TILES" "$BURST" > out.json 2>driver.log || {
  echo "driver FAILED:"; tail -25 driver.log; exit 1;
}
cat driver.log >&2
