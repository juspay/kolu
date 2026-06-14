#!/usr/bin/env bash
# Before/after idle-window trace: repro.html (PR #1348 aura) vs repro-fixed.html
# (the fix) at matched tile counts, all on-screen. Plus the realistic gated case.
# Run from this directory after resolving Chrome + installing deps (see the
# investigation note, ../../canvas-tile-aura-cpu.md). Self-contained: fresh
# Chrome per scene, 6 s idle window each.
#
#   nix build --no-link --print-out-paths nixpkgs#playwright-driver.browsers > browsers_path
#   nix shell nixpkgs#nodejs --command bash -c 'npm i chrome-remote-interface && bash run-compare.sh'
set -euo pipefail
cd "$(dirname "$0")"
HERE="$PWD"
BROWSERS="$(cat browsers_path)"
CHROME=""
for c in "$BROWSERS"/chromium-*/chrome-linux/chrome "$BROWSERS"/chromium-*/chrome-linux64/chrome; do
  [[ -x "$c" ]] && CHROME="$c" && break
done
[[ -z "$CHROME" ]] && { echo "no chrome under $BROWSERS"; exit 1; }
IDLE_MS="${IDLE_MS:-6000}"; PORT=9222
launch() { local udd; udd="$(mktemp -d)"; echo "$udd" > .udd
  "$CHROME" --headless=new --no-sandbox --disable-dev-shm-usage \
    --remote-debugging-port=$PORT --remote-allow-origins='*' --user-data-dir="$udd" \
    --window-size=1920,1080 --force-device-scale-factor=1 --no-first-run \
    --disable-renderer-backgrounding about:blank >chrome.log 2>&1 &
  echo $! > .cpid
  for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break; sleep 0.2; done
}
killc() { kill "$(cat .cpid)" 2>/dev/null || true; wait "$(cat .cpid)" 2>/dev/null || true; rm -rf "$(cat .udd)"; }
trace() { local tag="$1" url="$2"; launch
  node trace.js "$url" "$IDLE_MS" "$PORT" "$tag" > "out-$tag.json" 2>"e-$tag.log" || { echo "$tag FAILED"; tail -3 "e-$tag.log"; }
  killc
  node -e "const d=require('$HERE/out-$tag.json');console.log('  '+'$tag'.padEnd(16),'main',String(d.mainThreadBusyMs).padStart(6)+'ms('+d.mainThreadBusyPct+'%)','paints',d.paintEventCount)"
}
PR="file://$HERE/repro.html"; FX="file://$HERE/repro-fixed.html"
echo "── before/after (6s idle, all on-screen) ──"
for n in 24 48; do trace "pr-n$n" "$PR?n=$n&aura=1"; trace "fixed-n$n" "$FX?n=$n&aura=1"; done
echo "── realistic 40-tile canvas (~16 on-screen) ──"
trace "pr-realistic"  "$PR?n=40&aura=1"
trace "fixed-gated"   "$FX?n=40&aura=1&gate=1"
echo "DONE"
