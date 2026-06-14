#!/usr/bin/env bash
# Real-GPU before/after on zest (M1 Max). Headless-new Chrome WITH GPU. Prints
# chrome://gpu feature status + per-thread busy so GPU engagement is verifiable
# (on a real GPU the FIXED VizCompositorThread collapses vs the software box).
set -uo pipefail
cd /tmp/aura-mac
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=9456; IDLE_MS="${IDLE_MS:-6000}"
launch() { local udd; udd="$(mktemp -d)"; echo "$udd" > .udd
  "$CHROME" --headless=new --remote-debugging-port=$PORT --remote-allow-origins='*' \
    --user-data-dir="$udd" --no-first-run --enable-gpu-rasterization --ignore-gpu-blocklist \
    --window-size=1920,1080 --force-device-scale-factor=1 about:blank >chrome.log 2>&1 &
  echo $! > .cpid
  for _ in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break; sleep 0.2; done
}
killc() { kill "$(cat .cpid)" 2>/dev/null || true; sleep 0.6; rm -rf "$(cat .udd)" 2>/dev/null || true; }

launch
node -e 'const CDP=require("/tmp/aura-mac/node_modules/chrome-remote-interface");
(async()=>{const c=await CDP({port:9456});const{Page,Runtime}=c;await Page.enable();
await Page.navigate({url:"chrome://gpu"});await Page.loadEventFired();await new Promise(r=>setTimeout(r,3500));
const{result}=await Runtime.evaluate({expression:"document.body.innerText.split(String.fromCharCode(10)).map(function(s){return s.trim()}).filter(function(l){return /(accelerated|software only|disabled|Metal|ANGLE|GL_RENDERER|Vendor:)/i.test(l)}).slice(0,18).join(String.fromCharCode(10))",returnByValue:true});
console.log("=== chrome://gpu ===\n"+(result.value||"(no match)"));await c.close();})().catch(e=>console.error(String(e)));'
killc

trace() { local tag="$1" url="$2"; launch
  node trace.js "$url" "$IDLE_MS" "$PORT" "$tag" > "out-$tag.json" 2>"e-$tag.log" || { echo "$tag FAIL"; tail -3 "e-$tag.log"; }
  killc
  node -e "const d=require('/tmp/aura-mac/out-$tag.json');console.log('  '+'$tag'.padEnd(14),'main',String(d.mainThreadBusyMs).padStart(6)+'ms','viz',String(d.busyByThreadMs.VizCompositorThread||0).padStart(7)+'ms','gpu',String(d.busyByThreadMs.CrGpuMain||0).padStart(6)+'ms','comp',String(d.compositorBusyMs).padStart(5)+'ms','paints',d.paintEventCount)"
}
echo "── zest M1 Max · headless GPU · 6s idle ──"
trace "gpu-pr-n24"    "file:///tmp/aura-mac/repro.html?n=24&aura=1"
trace "gpu-fixed-n24" "file:///tmp/aura-mac/repro-fixed.html?n=24&aura=1"
trace "gpu-pr-n48"    "file:///tmp/aura-mac/repro.html?n=48&aura=1"
trace "gpu-fixed-n48" "file:///tmp/aura-mac/repro-fixed.html?n=48&aura=1"
trace "gpu-realistic-pr"    "file:///tmp/aura-mac/repro.html?n=40&aura=1"
trace "gpu-realistic-fixed" "file:///tmp/aura-mac/repro-fixed.html?n=40&aura=1&gate=1"
echo DONE
