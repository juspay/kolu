# Multi-tile xterm CPU under Dock-scale agent load

Investigation of high browser / renderer CPU with a dense Dock of agent
terminals (Chrome Task Manager style symptom). Measured on a real Kolu
(`just dev-auto`) under multi-terminal load, with CDP idle-window traces
(6 s, no user input during the measurement window).

Sibling notes: [dock-and-eventloop-1308.md](./dock-and-eventloop-1308.md)
(dock CSS animations, #1354), [canvas-tile-aura-cpu.md](./canvas-tile-aura-cpu.md)
(tile aura, #1348). Those fixed paint-only CSS; this note is a different
hot path that still burns main-thread CPU after those fixes.

---

## TL;DR

- Under Dock-scale load (many terminals receiving continuous agent/TUI-like
  output), **each PTY chunk drives `term.write` → buffer parse +
  `requestAnimationFrame` paint on `CrRendererMain`**. Cost scales with the
  number of simultaneously updating tiles.
- CSS dock / tile-aura animations were **not** the driver this time (A/B
  re-inject of auras ≈ same main-thread busy; already compositor-friendly
  after #1354 / #1348).
- Headline pre-fix dense flood (16 tiles, ~8 flooding): **3896 ms
  main-thread busy / 6 s (64.9%)**, almost all nested in `FunctionCall` +
  `FireAnimationFrame`.
- Fix: **coalesce PTY→xterm writes for unfocused terminals**
  (`createOutputCoalesce`, 100 ms window). Focused tile stays real-time.
- After (same box, equal-or-harder flood): **1541 ms (25.7%) main-thread
  (−60%)**, `FireAnimationFrame` **3657 → 59 ms (−98%)**, `FunctionCall`
  **3707 → 197 ms (−95%)**.

---

## Environment

| Item | Value |
|---|---|
| Host | `kolu-ci-7` (existing pu/Incus box; fresh `pu create` failed capacity) |
| Kolu | `just dev-auto` at master tip `3971f99`, client + server on random ports |
| Browser | Playwright Chrome-for-Testing **141.0.7390.37**, headless, CDP port 9222 |
| Method | 6 s continuous CDP Tracing (`devtools.timeline` + metadata); aggregate `RunTask` on `CrRendererMain`, plus named rendering events |
| Load | 16 canvas tiles; dense shell flood on up to 8 on-screen tiles (`while true; do … printf …; sleep …; done`). opencode without credentials did not fully stand up agents — flood matches the main-thread signature of multi-agent TUI churn |

Harness scripts (session scratch / box `/tmp/kolu-cpu-repro/`): `measure-idle.js`,
`drive-load.js`, ad-hoc CDP drivers for flood + scale + A/B.

---

## Measurement series

All windows are **6 s idle** after load is running (no clicks/keys during
the trace). Times are ms of busy `RunTask` on the named thread unless noted.
Inclusive event times nest (e.g. `FunctionCall` inside `FireAnimationFrame`),
so they can sum above main-thread busy.

### 1. Baselines — density alone is cheap

| Scene | Main-thread (ms) | Main % | Paints / 6 s | Notes |
|---|---:|---:|---:|---|
| 1 tile, idle shell | 155 | 2.6% | 20 | empty-ish canvas |
| 16 tiles, idle shells | 339 | 5.6% | 20 | no continuous output |
| 16 tiles, floods stopped | 17 | 0.3% | 0 | re-baseline mid-session |

Idle density does **not** reproduce the symptom. Continuous output does.

### 2. A/B — CSS auras are not the primary cost

With light terminal churn already present; inject `data-aura="working"` + dock
spin glows (32 running CSS animations) vs strip them:

| Scene | Main-thread (ms) | Main % | Paints / 6 s |
|---|---:|---:|---:|
| no aura | 738 | 12.3% | 20 |
| with aura (32 anims) | 652 | 10.9% | 60 |
| pure term (auras removed again) | 638 | 10.6% | 20 |

Aura inject raised paint count modestly; main-thread busy did **not** jump.
Consistent with post-#1348 / #1354 compositor-only motion (`transform` /
`opacity`). Ruled out as the headline cause for this repro.

### 3. Scale — cost tracks flooding tiles

Moderate flood (`30` lines / `0.03 s` sleep), 16 tiles present, flood N
on-screen tiles:

| Flooding tiles | Main-thread (ms) | Main % | Paints / 6 s | `FireAnimationFrame` (ms) | `FunctionCall` (ms) |
|---:|---:|---:|---:|---:|---:|
| 0 (idle) | 17 | 0.3% | 0 | — | 15 |
| 1 | 205 | 3.4% | 0 | 25 | 74 |
| 4 | 1014 | 16.9% | 646 | 536 | 604 |
| 8 | 1024 | 17.1% | 630 | 547 | 630 |

Paint spikes appear when DOM-renderer tiles are in the flood set (WebGL budget
caps concurrent WebGL at 8; older tiles fall back to DOM).

### 4. Dense flood — pre-fix headline (the repro)

Load: ~8 tiles, `20` lines per tick, `sleep 0.05` — closer to continuous TUI
redraw pressure.

| Metric | Value |
|---|---:|
| Main-thread busy / 6 s | **3896 ms** |
| Main-thread busy % | **64.9%** |
| Paint events | 270 |
| `FunctionCall` (inclusive ms) | 3707 |
| `FireAnimationFrame` (inclusive ms) | 3657 |
| `Layerize` | 55 |
| `Paint` event time | 20 |
| `UpdateLayoutTree` | 16 |

Almost all main-thread time sits in the xterm write → parse → rAF paint path,
not Blink style/layout thrash and not CSS animation.

### 5. Mixed 6-tile flood (control points)

| Scene | Main-thread (ms) | Main % | Paints |
|---|---:|---:|---:|
| mixed-auto 6 flood | 927–929 | 15.4–15.5% | ~630–666 |
| half tiles `visibility:hidden` | 1282 | 21.4% | 0 |
| `content-visibility` one live | 642 | 10.7% | 0 |

Hiding tiles does not cleanly pause xterm’s JS parse/rAF path the way write
coalescing does; paint can go to zero while main-thread FunctionCall remains.

### 6. After fix — unfocused write coalesce

Code: `packages/xterm-kit/src/solid/outputCoalesce.ts` (`UNFOCUSED_COALESCE_MS =
100`), composed into `<Xterm>` so `handle.write` is the single door; Terminal
passes `fullRate={isFocused}`. Unfocused batches chunks and flushes on timer or
focus; fresh-snapshot reset drops coalesce + scroll-lock + xterm write queue.

| Metric | Before (dense flood) | After (equal-or-harder flood) | Δ |
|---|---:|---:|---|
| Main-thread busy / 6 s | 3896 ms (64.9%) | **1541 ms (25.7%)** | **−60%** |
| `FireAnimationFrame` | 3657 ms | **59 ms** | **−98%** |
| `FunctionCall` | 3707 ms | **197 ms** | **−95%** |
| First post-fix dense-8 pass | — | 2777 ms (46.3%) | intermediate (softer flood) |

Post-fix dense2 top events (6 s):

| Event | ms (inclusive) |
|---|---:|
| RunTask (all threads sum) | 7187 |
| Commit | 899 |
| GPUTask | 707 |
| v8.callFunction | 292 |
| RasterTask | 223 |
| FunctionCall | 197 |
| FireAnimationFrame | 59 |
| Paint | 32 |

`CrRendererMain` 1541 ms; residual cost includes compositor/GPU threads
(`VizCompositorThread` still busy under multi-canvas WebGL) — outside the
coalesce gate, tracked separately if it becomes the next bottleneck.

---

## Root cause (single primary)

**Concurrent xterm.js parse + rAF paint across many attached canvas tiles
receiving continuous PTY output.**

Canvas mode keeps every tile mounted with `visible={true}` so inactive xterms
stay grid-sized. Every attached stream still feeds `term.write` at full rate.
Under multi-agent Dock load that becomes N independent full-rate renderers on
one renderer process.

Not primarily:

1. Dock chip / pill CSS (already fixed; A/B no main-thread jump).
2. Tile aura CSS (already gated + compositor motion; A/B no main-thread jump).
3. ResizeObserver / viewport JS storm (prior #1308 negative still holds for idle).

---

## Fix

| Piece | Location |
|---|---|
| Pure coalesce | `@kolu/xterm-kit/solid` → `createOutputCoalesce` |
| Wire | `packages/client/src/terminal/Terminal.tsx` attach `output.write` |
| Tests | `packages/xterm-kit/src/solid/outputCoalesce.test.ts` (6 cases) |

Policy:

- `isFullRate` ⇔ terminal is focused → immediate write.
- Otherwise buffer chunks for ≤100 ms, one write, fire all `onParsed` after
  the coalesced write lands (same callback contract as scroll-lock).
- Flush when focus becomes true so the user never lands on a stale buffer.

---

## How to re-run

1. Boot Kolu on a box: `just dev-auto` (or reuse a quiet `kolu-ci-N`).
2. Headless Chrome with `--remote-debugging-port=9222`.
3. Create ~16 tiles; dense-flood ~8 on-screen shells (or real agents).
4. Idle 6 s CDP trace → compare `CrRendererMain` busy, `FireAnimationFrame`,
   `FunctionCall` before/after.

Raw JSON captures from this run (session scratch):
`repro-cpu-before.json`, `repro-cpu-after.json`, `repro-cpu-after-dense2.json`,
`repro-cpu-before-empty.json`, `dense-flood.json`, `scale.json`, `ab-results.json`,
`root-cause.md`.
