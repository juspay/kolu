#!/usr/bin/env bash
# #1399 live precursor probe — orchestrator. Run on the real W6800 box, from the
# kolu repo root, inside the e2e devshell:  nix develop .#e2e -c bash .repro/live/run.sh
#
# Requires: a running kolu at $KOLU_URL (prefer a CLEAN `just dev-auto` instance,
# auth-free + instrumentable + same code), and nixos-k1399.nix applied so the
# safety monitor can read the kernel log.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
KOLU_URL="${KOLU_URL:?Set KOLU_URL (e.g. the client URL printed by 'just dev-auto')}"
CHROMIUM="${CHROMIUM:-$(command -v chromium || command -v google-chrome-stable || command -v chromium-browser)}"
PROFILE=/tmp/k1399-profile
PORT="${PORT:-9222}"
CHROME_LOG=/tmp/k1399.chrome.log
rm -rf "$PROFILE"; rm -f /tmp/k1399.stop /tmp/k1399.abort.log "$CHROME_LOG" /tmp/k1399-live.json

echo "[run] discrete GPU present?"; for c in /sys/class/drm/card?; do grep -l 73a3 "$c"/device/uevent 2>/dev/null && echo "  -> W6800 at $c"; done || true

echo "[run] starting safety monitor"
bash "$HERE/safety-monitor.sh" & MON=$!
trap 'kill -9 "${CHROME:-0}" 2>/dev/null||true; kill "$MON" 2>/dev/null||true; pkill -9 -f k1399-profile 2>/dev/null||true' EXIT

echo "[run] launching dedicated Chromium (profile=$PROFILE, CDP :$PORT) at $KOLU_URL"
"$CHROMIUM" --user-data-dir="$PROFILE" --remote-debugging-port="$PORT" \
  --new-window "$KOLU_URL" --no-first-run --no-default-browser-check \
  --password-store=basic --enable-logging=stderr --v=0 >"$CHROME_LOG" 2>&1 & CHROME=$!
echo "$CHROME" > /tmp/k1399.chrome.pid

echo "[run] waiting for CDP"
for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null && break; sleep 0.5; done

echo "[run] driving probe"
node "$HERE/drive-live.mjs" "http://127.0.0.1:$PORT" "$CHROME_LOG" || true

echo "[run] done."
echo "  results : /tmp/k1399-live.json"
echo "  aborts  : /tmp/k1399.abort.log (empty == no kernel fault seen)"
