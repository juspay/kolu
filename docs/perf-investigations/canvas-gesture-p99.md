# Canvas pan/zoom: the write-storm IS the cost on a weak client (R3 → R4)

Closing the loop #1308 left open. That investigation measured the per-wheel
viewport-signal storm at native speed and filed it under *real, but benign*:

> "At #1308's real scale, the storm does 8–24× more transform writes than a
> rAF-coalesced version would — yet stays at ~60 fps. It's a *latent* efficiency
> win, not a reproduced stress … a heavier canvas, a 120 Hz panel, or **a much
> weaker client** might surface one."
> — [`dock-and-eventloop-1308.md`](./dock-and-eventloop-1308.md), "P3 — real, but benign"

R3 built the harness for the "much weaker client" case (`setCPUThrottlingRate`).
It surfaced the stress decisively, so R4 (rAF-coalescing the storm) shipped in the
same PR — gated, per the plan, on the storm actually crossing a visible-jank bar
under throttle. It does, by a wide margin, and the fix is provably feel-neutral.

Harness: [`scripts/gesture-p99/`](./scripts/gesture-p99/) (`run.sh` + `driver.cjs`,
dependency-free CDP over Node's built-in WebSocket).

---

## The storm, recap (what R4 changes)

`canvas/viewport/gestures.ts` calls `onPan`/`onZoom` synchronously per raw wheel
event, and `useCanvasViewport.ts` wrote `panX`/`panY`/`zoom` on every one. Each
write makes **every mounted tile** recompute its `transform` (`CanvasTile.tsx`'s
`tiledStyle()` reads the pan/zoom signals). Wheel events arrive at ~166/s — several
per 60 Hz frame — so most of those per-event recomputes are thrown away before the
next paint. R4 accumulates the frame's pan delta (sum) and zoom (a per-event-
clamped running factor toward the last anchor) and applies them **once per
`requestAnimationFrame`**.

The coalescing is **behaviour-preserving for the two regimes a frame actually
sees** — a wheel event is *either* pan (plain/shift) *or* zoom (ctrl/meta),
never both. A summed pan delta ÷ zoom equals the sum of per-event pans; a
per-event-clamped zoom factor toward a fixed anchor telescopes to the same
pan+zoom the per-event chain reaches (the `point/zoom` terms in `zoomTowardPoint`
cancel, and clamping is applied per event so a frame that crosses MIN/MAX_ZOOM
still matches — see [F1](#codex-review)). Both equivalences are pinned in
`transforms.test.ts`. The only frame that is *not* an exact per-event replay is
the rare one that **mixes** pan and zoom (e.g. a pointer-drag pan while
ctrl+wheel zooming): there R4 applies zoom first and divides the whole summed pan
by the post-zoom scale — a deliberate, bounded approximation (one frame's worth of
zoom change, non-accumulating) chosen because exact replay would mean re-walking
the per-event list, the work R4 exists to delete.

## Method: a burst microbenchmark, not an rAF-paced fling

The first cut paced a fling (120 wheel events, 6 ms apart) and read rAF frame
deltas — the #1308 approach. **It can't measure coalescing in a headless/CDP
Chrome**: with no real display, Chrome's rAF clock isn't vsync-capped — it
produces ~one frame per dispatched input event (confirmed: gesture intents ==
rAF flushes, 1:1, headless *and* headful-under-xvfb). So every event gets its own
frame and coalescing is a no-op *in that harness only*. Chrome 143 also dropped
`HeadlessExperimental.beginFrame`, so manual frame-clocking is out.

So the harness measures the thing R4 actually changes — **per-event main-thread
work** — independent of the frame scheduler. It dispatches a **burst of K=60 real
`WheelEvent`s from page JS in a tight loop** (no `await`, so no rAF/microtask runs
mid-loop) through the live capture-phase gesture listener — exactly the "many
events between two paints" regime R4 targets:

- **Before R4 (per-event):** each event writes the signals synchronously, so the
  burst does K full tile-recomputes. The main thread is **blocked** for the whole
  burst; tile writes = K × tiles.
- **After R4 (coalesced):** the K events only accumulate; one rAF flush *after*
  the burst applies them once. The synchronous block is ~nothing; tile writes =
  1 × tiles.

16 tiles, median of 7 bursts, swept over 1× / 4× / 6× CPU throttle.

## Result: 60× fewer writes, and the freeze goes away

`burstMs` is the synchronous main-thread block while a 60-event burst is
processed — the freeze a user feels. `framesBlocked` = `burstMs` ÷ 16.67 ms.

| throttle · gesture | burstMs (master → R4) | tile writes (master → R4) | framesBlocked (master → R4) |
|---|---|---|---|
| 1× pan  | 43.8 → **0.4**  | 960 → **16**   | 2.6 → **0.02** |
| 1× zoom | 123.4 → **0.6** | 2,880 → **48** | 7.4 → **0.04** |
| 4× pan  | 190.6 → **0.5** | 960 → **16**   | 11.4 → **0.03** |
| 4× zoom | 534.9 → **1.0** | 2,880 → **48** | 32.1 → **0.06** |
| 6× pan  | 283.2 → **1.0** | 960 → **16**   | 17.0 → **0.06** |
| 6× zoom | **865.5 → 1.3** | 2,880 → **48** | **51.9 → 0.08** |

The tile-write ratio is exactly **K = 60** (60 events → 1 apply) everywhere, which
*is* the coalescing. The worst case — a zoom fling on a 6× client — went from a
**~865 ms main-thread freeze** (≈ 52 missed 60 Hz frames; the page is locked for
most of a second) to **1.3 ms**. Zoom is 3× pan because it writes three signals
(`panX`+`panY`+`zoom`) per event.

This is the "weak client" #1308 predicted. Even at **native** speed one zoom event
already costs ~2 ms (12% of a frame); a real fling delivers ~2.8 events/frame, so
the per-frame gesture cost was multiplying with no visible benefit. R4 makes a
frame's gesture work **one apply, regardless of how many events landed in it**.

### Honesty on the metric

`burstMs` is the *synchronous* block, which is what janks. R4 defers a single
coalesced apply to the next rAF — cost ≈ one master event (the 48-write flush) —
so it is not hidden work: the **60× drop in tile writes** is a real total-work
reduction, not a deferral. The burst (60 events, no interleaved frame) is an
amplified worst case; the regime-independent truth is `perEventµs`, and the
per-event recompute cost is high enough (2 ms native, ~14 ms at 6×) that even one
event per frame is a risk and several per frame is a guaranteed drop.

---

## Lessons

- **A "benign" cost is benign *at a tested operating point*.** #1308 was right at
  native speed and right to defer; the same storm on a throttled client is a
  near-second freeze. The deferral note named the exact condition to re-test, and
  that's what made R4 measured rather than guessed.
- **Match the harness to the regime you're measuring.** Headless rAF ≈ input rate,
  so an rAF-paced fling can't show frame-rate coalescing there. Measuring
  per-event *work* (a synchronous burst) sidesteps the frame scheduler entirely
  and is what R4 actually changes.
- **Make the fix provably transparent.** Canvas gestures have no e2e coverage, so
  the coalescing rides on a unit test proving the batched apply equals the
  per-event chain — the safety net is the math, pinned, not a screenshot.

## Reproducing it

```sh
just dev-auto                       # random ports; NEVER `just dev`
bash docs/perf-investigations/scripts/gesture-p99/run.sh   # reads .dev-server/ports.json
```

Prints the throttle × gesture table above and writes `out.json`. For a
before/after, `git stash` the `useCanvasViewport.ts` + `transforms.ts` change
(Vite reverts the served module on the next navigation) and re-run.

## Codex review {#codex-review}

A codex pass on the diff caught two equivalence gaps worth recording:

- **F1 — zoom clamping at a bound (fixed).** The first cut accumulated the *raw
  product* of factors and clamped once at flush. Near MIN/MAX_ZOOM that lets an
  overshoot past the bound cancel a later reversal — e.g. from MAX_ZOOM the
  factors `[1.25, 0.8]` have product 1 and would not move, where the per-event
  path clamps the first to the bound and zooms the second back out to 2.4×. The
  fix (`accumulateZoom` in `transforms.ts`) folds each event's clamp into a
  running clamped zoom and stores the *net effective* factor; the pan correction
  still telescopes (fixed anchor ⇒ intermediate zooms cancel even when clamped),
  so it stays one apply and zero per-event allocation. Pinned by the
  bound-reversal tests in `transforms.test.ts`.
- **F2 — mixed pan+zoom frames (documented as intentional).** A frame that mixes
  a pan and a zoom is not an exact per-event replay — R4 applies zoom first and
  divides the summed pan by the post-zoom scale. A wheel event is pan *xor* zoom,
  so this only arises when a pointer-drag pan overlaps a ctrl+wheel zoom; the
  discrepancy is one frame's bounded, non-accumulating zoom delta. We keep the
  canonical zoom-then-pan order rather than re-walking the per-event list (the
  work R4 deletes); the `applyGestureBatch` docstring states this explicitly.
