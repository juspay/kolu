# #1399 — reproduction handoff (for the reporter, on the real W6800 box)

Hi — thanks for the detailed report on
[#1399](https://github.com/juspay/kolu/issues/1399). We tried to reproduce the
kolu-side cause and need one measurement on **your actual hardware** to settle it.
This doc is fully self-contained; you can run the **Manual path** by hand, or feed
the **Automated path** to opencode.

## What we already found (so you know what we're testing)

We reproduced the *claimed* cause — the P2 ResizeObserver→`fit()` "oscillation"
and the P4 `--app-h` sub-pixel churn — on clean hardware (fresh box, identical
code with P2/P4 absent), under heavy load (8 terminals, continuous output),
at both integer and **fractional** display scaling, plus canvas zoom/pan:

| Condition | ResizeObserver | `fit()` | `--app-h` writes |
|---|---|---|---|
| 30s heavy load, **no resize** | **0** | **0** | **0** |
| canvas zoom/pan storm | **0** | **0** | **0** |
| 40 rapid window resizes | 39 (1:1) | **0** (rAF-absorbed) | 39 (1:1) |

So kolu writes geometry only **1:1 in response to real resizes/zoom**, with no
self-sustaining loop — matching the maintainer's own #1308 measurement
(`docs/perf-investigations/dock-and-eventloop-1308.md`: 0 fires at 20 tiles + 15
live TUIs), which is *why* P2/P4 were deliberately never shipped.

**The one thing we couldn't test is your exact regime:** AMD Navi 21 (W6800) +
Mutter 49 Wayland + Mesa 25.2.6 + fractional scaling. The crash's faulting
client is `chromium:cs0` (Chromium's GPU/compositor), and the `ProduceSkia` +
Mutter `stack_position` signatures point *below* kolu. This test will either find
churn under your setup or confirm the cause is in the compositor/Mesa stack.

> ⚠️ **Safety.** A real amdgpu MODE1 reset crashes your whole Wayland session
> (gnome-shell, Xwayland, browsers). **Save all work first.** Keep a kernel-log
> watch open and stop the instant a fault line appears. This test only resizes /
> zooms a browser window and runs normal terminals — never run synthetic GPU
> stress, and never touch any amdgpu reset/debugfs control.

---

## Step 0 — one-time NixOS grant (so the abort-watch can read the kernel log)

Add to your config, `sudo nixos-rebuild switch`, and remove it after:

```nix
{ boot.kernel.sysctl."kernel.dmesg_restrict" = 0; }
```

Verify: `dmesg | tail` works without sudo. (If you'd rather not, just run the
`journalctl -kf` / `dmesg -w` watch in Step 1 with `sudo` instead.)

---

## Manual path (recommended — safest, human-in-the-loop)

**1. Arm the abort-watch** in a dedicated terminal; leave it visible:
```sh
sudo dmesg -w | grep --line-buffered -iE 'page fault|ring .*timeout|gpu reset|MODE1|VRAM is lost|context is lost'
```
**Abort everything the instant any line prints** (close the kolu tab, stop the
load). Optionally also: `journalctl --user -f -o cat | grep --line-buffered stack_position`.

**2. Open kolu in Chromium**, open DevTools (F12) → Console, paste once:
```js
(() => {
  const R = (window.__k1399 = { appH: [], vv: [], ro: 0, start: performance.now() });
  const sp = CSSStyleDeclaration.prototype.setProperty;
  if (!sp.__k1399) { CSSStyleDeclaration.prototype.setProperty = function (n, v, p) {
    if (n === '--app-h') R.appH.push({ t: Math.round(performance.now()), v: String(v) });
    return sp.call(this, n, v, p); }; CSSStyleDeclaration.prototype.setProperty.__k1399 = true; }
  window.visualViewport?.addEventListener('resize', () => R.vv.push({ h: visualViewport.height, dpr: devicePixelRatio }));
  const RO = window.ResizeObserver; window.ResizeObserver = class extends RO { constructor(cb){ super((e,o)=>{ R.ro+=e.length; return cb(e,o); }); } };
  window.k1399report = () => ({ seconds: Math.round((performance.now()-R.start)/1000),
    appH_writes: R.appH.length, appH_distinct: [...new Set(R.appH.map(x=>x.v))],
    vv_resizes: R.vv.length, ro_fires_newTerminals: R.ro });
  console.log('armed → k1399report()');
})();
```

**3. Build load:** create **6–7 terminals** (`Ctrl+Enter`) — *after* pasting, so
their ResizeObservers are wrapped — and start your usual agents / continuous
output in each. Open **Debug → Diagnostic info** and note WebGL `aliveDetached`,
`contextsLost`, total canvas count.

**4. Baseline:** sit idle 60s → run `k1399report()` in the console, note numbers.

**5. Apply the drivers (~30–60s), watching the abort terminal:**
- continuously **drag-resize** the kolu window; **maximize ⇄ restore** repeatedly;
- **flap the display scale** in GNOME Settings (100% ⇄ 125% ⇄ 150%) a few times;
- on the canvas: **pan/zoom storm**, and toggle Focus ⇄ Canvas mode ~30×.

Run `k1399report()` again; re-check Diagnostic info.

**6. Idle recheck:** stop all input, wait 30s, run `k1399report()` once more — the
key question is whether numbers **keep climbing with no input**.

---

## Automated path (optional — for opencode; one command)

From your kolu repo root (the dev branch you're on), with the Step 0 grant
applied. It starts a clean throwaway dev kolu, drives a dedicated-profile
Chromium over CDP through the same drivers, samples discrete-GPU VRAM, and
**hard-aborts** on the first kernel fault / `ProduceSkia` / VRAM>92%.

```sh
curl -fsSL <none> 2>/dev/null  # (no download — paste the script below to k1399.sh, then:)
nix develop .#e2e -c bash k1399.sh
```

`k1399.sh` (paste this into a file at the repo root):
```sh
#!/usr/bin/env bash
set -euo pipefail
PORT=9222; PROFILE=/tmp/k1399-profile; STOP=/tmp/k1399.stop
CHROME_LOG=/tmp/k1399.chrome.log; OUT=/tmp/k1399-live.json
CHROMIUM="${CHROMIUM:-$(command -v chromium google-chrome-stable chromium-browser 2>/dev/null | head -1)}"
rm -rf "$PROFILE"; rm -f "$STOP" /tmp/k1399.abort.log "$CHROME_LOG" "$OUT"
[ -n "$CHROMIUM" ] || { echo "no chromium found"; exit 1; }

# --- safety monitor: kill the driven browser on the first amdgpu fault ---
( PAT='page fault|ring .*timeout|gpu reset|MODE1|VRAM is lost|context is lost'
  if dmesg >/dev/null 2>&1; then SRC=(dmesg --follow); else SRC=(sudo -n dmesg --follow); fi
  "${SRC[@]}" 2>/dev/null | grep --line-buffered -iE "$PAT" | while IFS= read -r l; do
    echo "$(date -Is) ABORT: $l" | tee -a /tmp/k1399.abort.log; touch "$STOP"
    pkill -9 -f k1399-profile 2>/dev/null; break; done ) & MON=$!
trap 'kill -9 ${CHROME:-0} 2>/dev/null||true; kill $MON 2>/dev/null||true; pkill -9 -f k1399-profile 2>/dev/null||true' EXIT

# --- clean throwaway dev kolu on random ports ---
( just dev-auto >/tmp/k1399.dev.log 2>&1 & )
for _ in $(seq 1 60); do U=$(grep -oE 'client http://[^ ]+' /tmp/k1399.dev.log 2>/dev/null | awk '{print $2}'); [ -n "${U:-}" ] && break; sleep 1; done
[ -n "${U:-}" ] || { echo "dev kolu didn't start; see /tmp/k1399.dev.log"; exit 1; }
echo "kolu: $U"

"$CHROMIUM" --user-data-dir="$PROFILE" --remote-debugging-port=$PORT --new-window "$U" \
  --no-first-run --no-default-browser-check --password-store=basic >"$CHROME_LOG" 2>&1 & CHROME=$!
for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null && break; sleep 0.5; done

cat > /tmp/k1399-drive.mjs <<'JS'
import { chromium } from "playwright"; import fs from "node:fs";
const STOP="/tmp/k1399.stop", LOG="/tmp/k1399.chrome.log", OUT="/tmp/k1399-live.json";
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); let aborted=null;
const ck=()=>{ if(!aborted&&fs.existsSync(STOP))aborted="kernel-fault"; if(!aborted){try{if(/ProduceSkia/i.test(fs.readFileSync(LOG,"utf8")))aborted="ProduceSkia"}catch{}} };
function card(){const b="/sys/class/drm";let f=null;for(const c of fs.readdirSync(b)){if(!/^card\d+$/.test(c))continue;const d=`${b}/${c}/device`;try{const u=fs.readFileSync(`${d}/uevent`,"utf8");if(u.includes("73a3")||u.includes("0000:3d:00.0"))return d;if(fs.existsSync(`${d}/mem_info_vram_total`))f??=d}catch{}}return f}
const C=card();const gpu=()=>{if(!C)return null;const r=f=>{try{return Number(fs.readFileSync(`${C}/${f}`,"utf8").trim())}catch{return null}};const u=r("mem_info_vram_used"),t=r("mem_info_vram_total");return{usedMB:u&&Math.round(u/1048576),vramPct:u&&t?+(100*u/t).toFixed(1):null,busy:r("gpu_busy_percent")}};
const T=`(()=>{const R=(window.__k1399={appH:[],vv:[],ro:0});const sp=CSSStyleDeclaration.prototype.setProperty;if(!sp.__k1399){CSSStyleDeclaration.prototype.setProperty=function(n,v,p){if(n==='--app-h')R.appH.push(String(v));return sp.call(this,n,v,p)};CSSStyleDeclaration.prototype.setProperty.__k1399=true;}window.visualViewport&&window.visualViewport.addEventListener('resize',()=>R.vv.push(visualViewport.height));const RO=window.ResizeObserver;window.ResizeObserver=class extends RO{constructor(cb){super((e,o)=>{R.ro+=e.length;return cb(e,o)})}};})();`;
const rep=p=>p.evaluate(()=>{const R=window.__k1399||{appH:[],vv:[],ro:0};const d=[...new Set(R.appH)];return{appH:R.appH.length,distinct:d.length,sample:d.slice(0,12),vv:R.vv.length,ro:R.ro}});
const snaps=[];async function snap(p,l){ck();const r=await rep(p),g=gpu();snaps.push({l,...r,gpu:g});console.log(l,JSON.stringify({...r,gpu:g}))}
const ok=()=>{ck();const g=gpu();if(!aborted&&g?.vramPct>92)aborted=`VRAM ${g.vramPct}%`;return!aborted};
const b=await chromium.connectOverCDP(`http://127.0.0.1:9222`);const ctx=b.contexts()[0];
const p=ctx.pages().find(x=>/^https?:/.test(x.url()))||ctx.pages()[0];await p.bringToFront();
await p.waitForSelector('[data-visible] .xterm-screen, [data-testid="empty-state"]',{timeout:60000}).catch(()=>{});await p.evaluate(T);
for(let i=0;i<6&&ok();i++){await p.keyboard.press("Control+Enter");await sleep(500);await p.locator('[data-focused] .xterm-screen').first().click({timeout:5000}).catch(()=>{});await p.keyboard.type("while true; do echo $RANDOM busy; sleep 0.05; done");await p.keyboard.press("Enter");await sleep(300)}
await snap(p,"baseline_0s");for(let s=0;s<60&&ok();s+=10){await sleep(10000);await snap(p,`baseline_+${s+10}s`)}
console.log("driver A: zoom");for(let i=0;i<24&&ok();i++){await p.keyboard.press(i%2?"Control+Minus":"Control+Equal");await sleep(250)}await p.keyboard.press("Control+0");await snap(p,"after_zoom");
console.log("driver B: resize");try{const s=await ctx.newCDPSession(p);const{windowId,bounds}=await s.send("Browser.getWindowForTarget");await s.send("Browser.setWindowBounds",{windowId,bounds:{windowState:"normal"}}).catch(()=>{});for(let i=0;i<40&&ok();i++){await s.send("Browser.setWindowBounds",{windowId,bounds:{left:bounds.left??60,top:bounds.top??60,width:1400+(i%2),height:900+(i%2)}});await sleep(80)}}catch(e){console.log("resize n/a",e.message)}await snap(p,"after_resize");
console.log("idle recheck");for(let s=0;s<30&&ok();s+=10){await sleep(10000);await snap(p,`idle_+${s+10}s`)}
fs.writeFileSync(OUT,JSON.stringify({card:C,aborted,snaps},null,2));console.log("WROTE",OUT,"aborted:",aborted||"no");await b.close().catch(()=>{});process.exit(0);
JS
node /tmp/k1399-drive.mjs || true
echo "=== RESULT: /tmp/k1399-live.json ===  (abort log empty == no kernel fault)"
cat "$OUT" 2>/dev/null
```

---

## What to send back + how to read it

Send: `/tmp/k1399-live.json` (or the manual `k1399report()` outputs + Diagnostic
info JSON), `/tmp/k1399.abort.log`, and any `ProduceSkia` / `stack_position` lines.

| Signal | Means **not** kolu's geometry (cause is below kolu) | Means **reproduced** |
|---|---|---|
| `appH_writes` | ≈ number of resizes/scale-changes you did; settles when idle | climbs into hundreds+ and **keeps climbing while idle** |
| `appH` distinct values | a handful | a flood of sub-pixel-different values in one steady scale |
| Diagnostic `aliveDetached` / canvas count | returns to baseline on idle | climbs monotonically, never returns |
| Console / journal | clean | `ProduceSkia ... non-existent mailbox` or `meta_window_set_stack_position_no_sync` |

**The single most useful fact:** during your 14-minute pre-crash window, were you
**idle**, or actively resizing windows / changing display scale / dragging things?
Idle essentially rules out P4; active geometry changes point at an external
(compositor) driver feeding kolu's writes. Either way, please tell us which.
