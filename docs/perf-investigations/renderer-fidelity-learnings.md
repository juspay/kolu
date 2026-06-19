# Renderer-fidelity investigation: the #1299 "corruption" that wasn't

Notes from the June 2026 investigation of
[#1299](https://github.com/juspay/kolu/issues/1299) — "terminal render
artifacts on non-focused tiles". The issue arrived with a confident,
plausible, code-cited diagnosis (missing repaint after
`WebglAddon.dispose()`) and a three-part fix. All of it was wrong. As
with the memory hunts ([memory-learnings](./memory-learnings.md)), the
wrong turns are preserved here — they encode the lessons.

Outcome: split into [#1305](https://github.com/juspay/kolu/issues/1305)
(sub-pixel seams, kolu-side) and
[#1306](https://github.com/juspay/kolu/issues/1306) (renderer metric
divergence, upstream
[xtermjs/xterm.js#6015](https://github.com/xtermjs/xterm.js/issues/6015)).

---

## Core lessons

### Correlation with a lifecycle event is not causation in that lifecycle

The artifact appeared at the exact moment a tile lost focus, so the
focus-loss code path (`unloadWebgl()`) looked guilty. But focus loss
*also* swaps the renderer (WebGL → DOM), and the artifact belonged
entirely to the destination renderer's steady-state output. The
teardown was innocent; it was merely the curtain-raiser.

### Steady-state vs transient: a one-shot bug cannot survive a redrawing TUI

The decisive armchair argument, available before any tooling: opencode
redraws its TUI continuously, so xterm re-renders the "broken" tile
many times per second through the ordinary data path. A missed repaint
after dispose would self-heal within one opencode frame. A *persistent*
artifact therefore cannot be a missing-repaint bug. Five minutes of
this reasoning invalidates the proposed `terminal.refresh()` fix
without running anything.

### Characterize the artifact physically before reading code

"Ghosting / corrupted glyphs / stale content" (the report) suggested
stale framebuffers and atlas corruption. Pixel-level decomposition of
the screenshots showed something else entirely: a single coherent
*current* frame with (a) 1px bright hairlines at every cell-row
boundary, (b) text laid out ~7.7% wider than the focused state, and
(c) bolder, browser-rasterized glyphs. Each component pointed at a
specific mechanism; none pointed at staleness. Eyeballing at 100% zoom
had produced three wrong adjectives; measuring produced two root causes.

---

## What it actually was

Two independent defects, visible only on unfocused tiles because that
is when kolu swaps WebGL → DOM (`Terminal.tsx` `shouldUseWebgl`, the
#575 context-budget policy):

### 1. Sub-pixel seams (#1305) — kolu's bug

`tileTransformCSS()` (`canvas/viewport/coordinates.ts`) composes
pan/zoom/drag into the tile translate without rounding; trackpad pans
accumulate fractional deltas. The repro tile sat at
`transform: matrix(1, 0, 0, 1, 242.5, -11.5)`.

The WebGL renderer doesn't care — one opaque bitmap. The DOM renderer
paints thousands of small inline-block boxes, and at a half-pixel
offset every box edge antialiases against the backdrop: xterm's
scrollable element, painted `theme.background`. With a light variegated
theme (white/cream) the blend is glaring — measured as background value
37 with a `147` line every 17px (the cell height), i.e. a ~50% blend of
the dark cell background against white. Dark themes hide the seams,
which is why only some tiles looked "broken".

**Toggle proof:** rounding the live transform to `translate(242px,
-11px)` removed every seam; restoring `.5` brought them back —
including immediately after a full `terminal.refresh(0, rows-1)`.

### 2. Cell-metric divergence (#1306 / upstream #6015)

Same `charSizeService.width` (8.6154), different grids:
`WebglRenderer._updateDimensions` floors
(`Math.floor(charW × dpr)` → device cell width **8**),
`DomRenderer._updateDimensions` doesn't (→ **8.6154**). The unfocused
tile lays text out +7.7% wider — the long-known "stable font on focus"
wobble named in `SettingsPopover`. The divergence is entirely inside
xterm's renderers, so the original plan was to pick up an upstream fix by
bumping the pnpm-overrides pin.

**Update (June 2026): upstream won't fix it, so kolu owns it.** On
[#6015](https://github.com/xtermjs/xterm.js/issues/6015#issuecomment-4694852375)
jerch ruled out both directions: un-flooring the WebGL cell blurs glyphs
/ introduces moiré, and correcting the DOM renderer with `letter-spacing`
re-introduces the per-span pressure a refactor had removed (a perf
regression) — *"swapping renderers forth and back is a weird use case."*
The pin bump will not come. kolu's resolution is to stop **exposing** the
divergence rather than eliminate it: the WebGL renderer is now budgeted to
the **2 most-recently-active tiles** (each slot covering its main pane +
active split), so the dominant A↔B focus switch never crosses the
WebGL↔DOM boundary and the +7.7% reflow disappears for it. Only evicting a
tile past the 2-slot budget still swaps it. See
[#1403](https://github.com/juspay/kolu/issues/1403) and
`useTerminalStore.ts` (`holdsWebgl` + `WEBGL_TILE_BUDGET`). *(Cause #2 of
#1400 — the selection-offset-under-zoom bug — was fixed separately and
filed upstream as
[#6023](https://github.com/xtermjs/xterm.js/issues/6023).)*

---

## The false leads, and how each died

| Hypothesis | Killed by |
| --- | --- |
| Missing repaint after `WebglAddon.dispose()` (the issue's claim) | Source: dispose's last disposable runs `setRenderer(core._createRenderer())` + `handleResize(cols, rows)`; `setRenderer` → `_fullRefresh()`. Verified byte-for-byte in the shipped bundles. Empirics: `terminal.refresh()` changed nothing with the artifact on screen. |
| Stale WebGL canvas left in the DOM (zombie layer over live rows) | Live DOM census: **zero** `<canvas>` elements in the broken tile. `WebglRenderer.dispose()` removes both canvases before the DOM renderer installs. |
| `RenderService._isPaused` (IntersectionObserver) swallowing the refresh | Both tiles fully on-screen; pause requires zero intersection, and unpausing self-heals via the latched `_needsFullRefresh`. |
| DEC-2026 synchronized output buffering the post-dispose refresh | Bounded: the `SynchronizedOutputHandler` force-disables the mode and full-refreshes after a 1000ms safety timeout. Cannot produce a persistent artifact. |
| Stale content (the literal "never repainted" reading) | The broken tile's text matched the live buffer; both user screenshots show current content with focus flipped. |

A version subtlety nearly derailed the source verification: the issue
cites `@xterm/xterm@6.0.0` / `addon-webgl@0.19.0` line numbers, but
kolu actually ships `6.1.0-beta.225` / `0.20.0-beta.224` via pnpm
overrides. The dispose-path behavior is identical in both — but check
what's *in `node_modules/.pnpm`*, not what `package.json` deps imply.

---

## Techniques worth reusing

### Pixel-column profiling (ImageMagick)

Crop a 1px-wide column through the artifact and print values:

```sh
magick shot.png -crop 1x140+X+Y +repage -depth 8 txt:-
```

A periodic outlier (here: `147` every 17px among `37`s) gives you the
artifact's *pitch*, which you can match against cell height, row pitch,
or page-grid pitch to identify which layer is leaking. The same crop
trick at 4–600% zoom (`-resize 400%`) beats squinting at full
screenshots; first-pass eyeballing misread the artifact entirely.

### Fractional-offset hunting

Walk ancestors of the artifact element and flag any
`getBoundingClientRect()` with non-integer x/y or any non-identity
`computed transform`. Then **toggle-test in place**: override the
transform to rounded values via devtools and re-screenshot. A root
cause you can switch on and off with one style edit is proven, not
argued.

### Same-content A/B differential

The reporter's two screenshots had identical terminal content with
focus flipped — a free controlled experiment. Word-start positions,
row pitch, and glyph-intensity histograms diffed between the
broken/healthy states of the *same* tile yield quantitative artifact
signatures (the +7.7% linear spread fell out of exactly this).

### Read the shipped bundle, not your memory of the library

Published xterm packages embed sources in their source maps:

```sh
node -e 'const m=require("./lib/xterm.js.map" /* JSON */); ...sourcesContent...'
```

Quoting the actual shipped lines (`WebglRenderer.ts:636` floors,
`DomRenderer.ts:138` doesn't) settled in minutes what would otherwise
be a debate about what xterm "probably" does. Same lesson as
[memory-learnings](./memory-learnings.md): the spec-reasoning fix
attempts were plausible and wrong.

### Live repro beats forensics when both are cheap

`just dev-auto` (dev-server skill) + two tiles + opencode from nixpkgs
reproduced the artifact in minutes and turned every remaining "open
question" from the screenshot analysis into a measured fact: renderer
attribution (`data-renderer`), canvas census, `dimensions` divergence,
the toggle proof, and the `refresh()` no-op.
