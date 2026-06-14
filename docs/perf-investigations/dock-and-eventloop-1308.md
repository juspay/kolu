# #1308: the dock animations were the stress; the event-loop items weren't

Investigation closing out
[#1308](https://github.com/juspay/kolu/issues/1308) ("Mitigate compositor stress
and Wayland geometry instability under heavy canvas load"). The issue arrived with
a confident, plausible, code-cited diagnosis naming **three** root causes — many
paint-only CSS animations, a ResizeObserver→`fit()` feedback loop, and a per-wheel
viewport-signal storm — plus a six-part P0–P5 proposal.

Measured end to end, only **one** of the three reproduces. This note records the
reproduction of the real culprit (the CSS animations, fixed in #1354) and the
reproduction *attempts* that came up empty (the JS event-loop items) — because a
faithfully-reproduced negative is as load-bearing as a positive: it's why we
shipped no speculative fix for two-thirds of the proposal.

Sibling note: [canvas-tile-aura-cpu.md](./canvas-tile-aura-cpu.md) covers the same
class of bug on the canvas *tile* border (#1352). Same harness, same lesson.

---

## What reproduced: the dock's per-terminal CSS animations (fixed in #1354)

The dock draws each terminal's agent state as motion: `dock-chip-spin-glow` /
`dock-chip-breathe` on rail chips, `pill-working-pulse` / `pill-awaiting-breathe`
on cards. Every one animated a **paint-only** property — `box-shadow` offset/spread,
or a `background` color-mix — so each live chip and pill repainted on the main
thread every frame, forever, scaling with the number of terminals.

Reproduced with the same idle-window CDP trace as #1352 (6 s, zero interaction),
the synthetic repro using the **verbatim** CSS from `index.css`:

**Real GPU — `zest`, M1 Max (where the production instances run):**

| Scene | GPU process (`CrGpuMain`) | Paints / 6 s |
|---|---|---|
| baseline (no animations) | 16 ms | 12 |
| 24 chips + 12 pills | 2,512 ms | 1,230 |
| 48 chips + 24 pills | 2,250 ms | **49,034** |
| **fixed**, 24 + 12 | **165 ms (−93%)** | **12** |
| **fixed**, 48 + 24 | **193 ms (−91%)** | **12** |

**Software regime (weak/contended GPU — the AMD/Wayland case that crashed):**

| Scene | Main-thread | Paints / 6 s |
|---|---|---|
| baseline | 99 ms | 8 |
| 24 chips + 12 pills | 1,112 ms | 12,639 |
| 48 chips + 24 pills | 1,910 ms | 24,553 |
| **fixed**, 24 + 12 | **401 ms (−64%)** | **10** |
| **fixed**, 48 + 24 | **580 ms (−70%)** | **10** |

The super-linear blow-up at 48 chips (49,034 paints/6 s on a real GPU) is the
compositor-queue saturation #1308 ties to the Mutter crash. The fix (#1354) moves
each glow to a child element whose `box-shadow` is painted **once**, animating only
`opacity`/`transform` — GPU work down ~93%, the repaint loop gone, look unchanged.

---

## What did NOT reproduce: the JS event-loop items (P2–P4)

These were tested against a **real kolu** (the `just dev-auto` dev server),
driven over CDP with injected instrumentation: a wrapped `ResizeObserver` (fire
count), a wrapped `setProperty` (`--app-h` count), a `requestAnimationFrame`
frame-duration recorder, and a `MutationObserver` on tile `transform` writes.

### ResizeObserver → `fit()` feedback loop (P2) — does not oscillate

The claim: `fit()` changes the xterm grid → `onResize` → `publishDimensions` →
PTY resize → output → DOM mutation → ResizeObserver fires again, sustaining on
sub-pixel differences.

| Measurement | Result |
|---|---|
| ResizeObserver fires, 8 s idle, 2 tiles | **0** |
| Fires in the 6 s settle window after one viewport resize | **0** (3 fires *on* the resize, then silent) |
| ResizeObserver fires, 8 s idle, **20 tiles + 15 live opencode TUIs** | **0** |

It does not close the loop. The ResizeObserver is on the terminal **container**,
which is sized by the tile layout (not by content), so terminal output never
resizes it; and the existing 1-frame rAF debounce coalesces the burst *on* a real
resize. No oscillation, even under 20 redrawing TUIs.

### `--app-h` sub-pixel churn (P4) — no desktop churn

`useVisualViewportHeight` sets `--app-h` on every `visualViewport` resize with no
guard. Measured `--app-h` writes at idle (2 tiles and 20 tiles): **0**. It fires
only on a real visual-viewport resize (e.g. the mobile soft keyboard), which does
not happen at rest on desktop.

### Per-wheel viewport-signal storm (P3) — real, but benign

Confirmed in code and in the trace: the wheel listener calls `onPan` synchronously
per raw event (no rAF coalesce), so each event rewrites **every** visible tile's
transform. The write count scales exactly linearly — but it does not jank.

| Heavy canvas: 20 tiles, 15 opencode TUIs | transform writes | frames > 20 ms |
|---|---|---|
| pan fling (120 shift+wheel) | 2,400 (= 120 × 20) | 4 / 284 (max 33 ms) |
| zoom fling (120 ctrl+wheel) | 7,080 (3 signals/event × 20) | **0 / 287** |

At #1308's real scale, the storm does 8–24× more transform writes than a
rAF-coalesced version would — yet stays at ~60 fps. It's a *latent* efficiency
win, not a reproduced stress, so per measure-first it was left alone: not worth
the risk to critical-path pan/zoom code without a repro that actually hurts (a
heavier canvas, a 120 Hz panel, or a much weaker client might surface one).

---

## Lessons

- **A reproduced negative is a result.** Two of #1308's three named causes don't
  reproduce; saying so with numbers is what justified shipping no code for them.
- **Read where the observer is attached.** The "feedback loop" hinges on the
  ResizeObserver watching a content-sized box. It watches a layout-sized one, so
  the loop can't close — visible only by reading the wiring, not the symptom.
- **"Confirmed mechanism" ≠ "confirmed stress."** The wheel storm's redundant
  writes are real and scale linearly; the user-visible cost is nil at tested
  scale. Fix the second, not the first.
- **Drive the real app for app-wiring questions.** The CSS cost reproduces in a
  synthetic repro; the event-loop questions (ResizeObserver, signal graph) only
  answer truthfully against a running kolu with real terminals.

---

## Reproducing it

Harness in [`scripts/dock-1308/`](./scripts/dock-1308/):

- `repro-1308.html` / `repro-1308-fixed.html` — the dock chip/pill/capsule
  animations (verbatim vs compositor-friendly); `trace.js` is shared with the
  tile-aura harness. Same idle-window CDP method as `canvas-tile-aura-cpu.md`.
- `kolu-driver.js` — instruments a running dev kolu (ResizeObserver / `--app-h` /
  frame / tile-transform counters) and runs the IDLE / RESIZE / WHEEL phases.
- `kolu-heavy.js` — creates ~20 terminals (Ctrl+T), runs opencode in most, and
  measures the storm + idle behavior under real TUI load.

The kolu drivers need a dev server (`just dev-auto`), `chrome-remote-interface`,
and a Chrome-for-Testing binary — see the header comments. Drive the **dev**
client URL only (never production's fixed ports).
