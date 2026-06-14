# Canvas tile-aura: the idle CPU it cost, and the fix

Investigation behind the perf fix for the canvas **tile state aura** shipped in
[#1348](https://github.com/juspay/kolu/pull/1348) ("agent run-state on tile
borders — run/sweep aura"). After that PR, an idle canvas kept the CPU busy. This
note records how that was measured, what was found, the fix, and the before/after
numbers — including an honest account of what the test environment *could not*
measure.

It is the direct, reproducible follow-up to
[#1308](https://github.com/juspay/kolu/issues/1308) ("Mitigate compositor stress
and Wayland geometry instability under heavy canvas load"), whose P0/P1/P5
recommendations this fix implements for the tile aura specifically.

---

## TL;DR

- #1348 mounts **one always-running CSS border animation per live tile**. The
  worst offender — the "marching ants" working state — animated
  `background-position`, which is **not** compositor-accelerated, so every
  working tile **repainted on the main thread every frame, forever**, on-screen
  or not.
- Measured on an idle canvas (zero interaction, 6 s window, headless): the aura
  turned **~4 paints/6 s into ~2,900**, and roughly **3.5–7×'d main-thread CPU**.
- The fix is three changes, all preserving the visual design:
  1. **Marching ants → compositor-only `transform`** (no more per-frame repaint).
  2. **Off-screen / covered tiles mount no aura at all** (off-screen CSS
     animations otherwise keep running).
  3. **`will-change` + `contain`** so the comet/pulse promote once instead of
     re-deciding layer promotion every frame.
- After: paints drop to **~4–12/6 s** and main-thread CPU drops in every
  configuration measured.

---

## Background: the symptom and #1308

The aura surfaces each tile's agent run-state as motion on its border:
*working* "runs" (marching ants on all four edges), *needs-you* "sweeps" (a comet
orbiting a masked ring, faster = more urgent). One `.tile-aura` child is mounted
per live tile and animates continuously.

#1308 had already flagged the underlying pattern repo-wide: *many concurrent
`infinite` CSS animations, no `will-change`, several animating paint-only
properties.* Under heavy canvas load that saturated Chromium's compositor and
**crashed GNOME Shell / Mutter** on AMD/Wayland (Mesa GPU-fence timeout; a logged
143 s compositor-observer hang). Its asks: **P0** add `will-change`; **P1**
replace paint-only animated properties with compositor-friendly ones; **P5**
pause off-screen animations. #1348 added a *new* always-on animation **per canvas
tile** with none of those mitigations — multiplying exactly the budget #1308 said
was already over the line.

---

## What the aura cost, and why

Three mechanisms, ranked by impact:

1. **Marching ants animate `background-position` → main-thread repaint every
   frame.** This is the dominant cost because *working* is the common state (any
   thinking/running agent). `background-position` is not in Blink's
   compositor-accelerated set, so each working tile re-rasterizes its four
   gradient edges on the main thread every frame. **GPU-independent** — it costs
   CPU on every machine.

2. **The comet defeats pure-GPU compositing via `mask-composite: exclude`.**
   `transform: rotate` alone is compositor-friendly, but it spins inside a masked
   layer whose *content* changes every frame, and the `::before` is `inset:-50%`
   (4× the tile area) of an expensive `conic-gradient`. With no `will-change`,
   the browser re-decides layer promotion each frame.

3. **No off-screen gating.** Chrome only pauses CSS animations when the *tab* is
   backgrounded — never when an element scrolls out of view. So a tile panned out
   of the canvas viewport, or sitting behind a maximized tile, kept animating
   invisibly. The aura was gated only on run-state, not visibility.

---

## Methodology

Goal: isolate the aura's contribution and measure it **at idle** (the symptom is
"CPU spins when I'm not even touching it").

- **Off the user's machine.** All measurement ran on an ephemeral `pu` box (a
  clean 32-core NixOS container) so nothing local was at risk and the
  environment was reproducible.
- **Faithful repro, not the whole app.** `repro.html` renders a grid of tiles
  with the aura CSS copied **verbatim** from `packages/client/src/index.css`, in
  a representative state mix (mostly working, some waiting, a few alert). This
  isolates the *delta* attributable to #1348 from xterm and the rest of kolu
  (which this PR doesn't touch).
- **Real Chrome, idle-window trace.** A Node script drives Chrome-for-Testing
  (the same Playwright build the chrome-devtools MCP uses, resolved via Nix) over
  the DevTools Protocol: navigate, let layout settle, then record a **6 s window
  during which the page does nothing** but run its CSS animations. The trace is
  aggregated into per-thread busy time (`RunTask` durations) and a rendering-event
  breakdown (style recalc, paint, …).
- **Headline metric: `CrRendererMain` busy + `Paint` count** during the idle
  window — the GPU-independent "CPU spinning" numbers.
- **Adversarial cross-check.** The rendering-pipeline claims (background-position
  is paint-bound; off-screen CSS animations don't pause; `mask-composite`
  defeats the cheap mask path; opacity/transform are compositor-accelerated) were
  independently web-verified against web.dev / Chrome / MDN / csstriggers.

### The one thing this environment could *not* measure: a real GPU

Both the `pu` container and the local headless setup have **no usable GPU** (the
container has none; local headless Chrome's GL init fails without a display
server — `Could not open the default X display`, GPU process exits). So all
compositing fell back to **software** (SwiftShader / the CPU `VizCompositorThread`).

This matters for interpretation:

- **Main-thread numbers and paint counts are GPU-independent** and transfer
  directly to a real machine. These are the ones to trust.
- **`VizCompositorThread` (software compositor) is *inflated* for the fixed
  version**, because compositor-only animation (`transform`/`opacity`) that a
  real GPU runs in dedicated hardware is forced onto the CPU here. On the user's
  actual GPU (e.g. the AMD card in #1308) that work is hardware-accelerated.

The fix's core improvement is therefore stated in GPU-independent terms: it
converts per-frame **raster** (`background-position`, expensive on any pipeline)
into per-frame **transform compositing** (a cheap matrix op, *no* re-raster — the
`Paint` count proves it), and removes work entirely for off-screen tiles.

---

## Measurements — before (PR #1348)

6 s idle window, headless software render, 32-core `pu` box. "Main" =
`CrRendererMain` busy; "paints" = `Paint` events in the window.

| Scene | Main-thread busy | Paints / 6 s |
|---|---|---|
| Baseline, 24 tiles (aura **off**) | ~95–102 ms (1.6%) | **4–8** |
| PR, 24 tiles (aura on) | ~310–433 ms (5–7%) | **~2,892** |
| PR, 48 tiles (aura on) | ~524–725 ms (9–12%) | **~3,604** |
| PR, 24 tiles **panned off-screen** | 509 ms | 364 |

Main-thread breakdown for the 24-tile PR scene: **style recalc on all 361 frames
(91 ms) + Paint 109 ms across 2,892 events** — i.e. a repaint every frame. The
baseline canvas is effectively static (4 paints in 6 s); the aura makes it repaint
~480×/s.

The off-screen row is the key finding: panning all tiles below the fold collapsed
painting (2,892 → 364) but **main-thread style recalc kept running every frame
and rose to 224 ms** — Chrome stopped *painting* the invisible tiles but kept
*animating* them. (Repeated 3× per headline pair; noise ±15%, dwarfed by the gap.)

---

## The fix

All three changes preserve the visual design (verified by screenshot parity — the
ants and comets look identical).

1. **Marching ants: `background-position` → `transform`.**
   `background-position` is now static *placement*; the dashes stream via
   `transform: translate` on two promoted pseudo-strips (`::before` = top+bottom,
   `::after` = left+right). Each strip is rasterized **once** and then composited
   — no per-frame repaint. Strips overhang their edges by one dash-period
   (clipped by `overflow: hidden`) so a one-period translate loops seamlessly.

2. **Off-screen gating (`CanvasTile.tsx`).** `showAura` now also requires
   `mode === "tiled"` **and** an on-screen check (the tile's screen rect, derived
   from the same pan/zoom mapping as `tileTransformCSS`, intersects the viewport
   plus a margin). Off-screen tiles, and tiles behind a maximized sibling, mount
   **no `.tile-aura` at all** — zero animation cost.

3. **`will-change` + `contain`.** The comet `::before` gets `will-change:
   transform`, the alert pulse `will-change: opacity`, and `.tile-aura` gets
   `contain: layout paint` so the animation can never invalidate the xterm body
   underneath.

---

## Measurements — after (fixed)

Same harness and conditions.

| Scene | Main-thread busy | Paints / 6 s | vs PR |
|---|---|---|---|
| Fixed, 24 tiles | ~285 ms | **4** | paints −99.9%, main −8 to −34% |
| Fixed, 48 tiles | ~355 ms | **8** | paints −99.8%, main −32% |

**Realistic canvas — 40 tiles, ~16 on-screen** (the configuration the gating
targets):

| Scene | Main-thread busy | Paints / 6 s |
|---|---|---|
| PR (all 40 auras animate) | 405 ms | 3,251 |
| Fixed, **ungated** (all 40) | 328 ms | 10 |
| Fixed, **gated** (~16 on-screen) | **245 ms** | 10 |

So: the CSS rewrite alone drops the main-thread repaint to nothing (paints
3,251 → 10), and gating drops main-thread CPU a further ~25% (328 → 245 ms) by not
animating the ~24 tiles you can't see.

> **Note on `VizCompositorThread`.** In this GPU-less environment the fixed
> version's software-compositor thread reads *higher* than the PR's, because the
> motion is now compositor-only and there is no GPU to run it. That number is a
> measurement artifact, not a regression: on a real GPU that work is
> hardware-accelerated, and the fix strictly *reduces* GPU load too (per-frame
> raster → cheap transform, plus far fewer animated tiles). The decision-relevant,
> GPU-independent metrics — main-thread CPU and paint count — improve everywhere.

---

## Findings / lessons

- **Animating `background-position` is a main-thread repaint trap.** It looks
  cheap (no JS, "just CSS") but it is not compositor-accelerated; for an
  `infinite` animation it is a permanent per-frame paint loop. Prefer `transform`.
- **Off-screen ≠ free.** CSS animations keep running for off-screen elements;
  only a backgrounded *tab* pauses them. Gate animations on visibility
  (here: a cheap reactive on-screen check; `content-visibility` /
  `IntersectionObserver` are alternatives).
- **Measure at idle.** A "my CPU spins" complaint is about *steady state*, not
  load time. A fixed idle window with zero interaction makes always-on animation
  cost unmissable.
- **Know what your harness can't see.** A GPU-less container is perfect for
  main-thread/paint cost and actively misleading for compositor cost. State the
  limitation and lean on the metrics that transfer.

---

## Reproducing it

The harness lives in [`scripts/tile-aura/`](./scripts/tile-aura/):

- `repro.html` — tiles with the **PR** aura CSS (verbatim).
- `repro-fixed.html` — tiles with the **fixed** aura CSS (`?gate=1` simulates the
  off-screen gating).
- `trace.js` — CDP idle-window tracer → per-thread busy + event breakdown JSON.
- `run-compare.sh` — fresh-Chrome-per-scene before/after runner.

On a clean box with Nix + flakes:

```sh
nix build --no-link --print-out-paths nixpkgs#playwright-driver.browsers > browsers_path
nix shell nixpkgs#nodejs --command bash -c 'npm i chrome-remote-interface && bash run-compare.sh'
```
