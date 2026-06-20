# Code-tab lazy-load: measured 171 kB gzip, deferred (the default-tab caveat)

Investigation of **backlog item #5** of the
[performance map](../atlas/src/content/atlas/performance.mdx) — *"lazy-mount the
Code tab off the eager bundle."* The implementation was built, gauntlet-reviewed,
and **e2e-verified working** on a pu box, then **deferred** — not because it
doesn't work, but because measurement showed the *value* is more nuanced than the
note assumed. (Same discipline as
[markdown-image-resolver-and-toggle](./markdown-image-resolver-and-toggle.md):
measure before you tune; record the honest outcome.)

## What was measured (A/B production build)

The Code tab mounts a heavy main-thread tree — Pierre's `FileTree`,
`@kolu/solid-markdown`, the diff/source view wrappers, and the comment system —
that was a static import. An A/B `pnpm --filter kolu-client build` (lazy-split
CodeTab vs static):

| | eager `index.js` | deferred |
|---|---|---|
| static (before) | 2,643 kB · 745 kB gzip | — |
| lazy (after) | ~2,016 kB · 575 kB gzip | CodeTab chunk 629 kB · **171 kB gzip** |

So the Code-tab tree is **171 kB gzip / 23%** of the eager bundle. That number is
solid and reproducible.

**Two of the note's premises were wrong, by measurement** (worth keeping even
though the item is deferred):

- **Shiki grammars were already lazy** — a dynamic `import("shiki")`, never on the
  eager path; the `@pierre/diffs` diff renderer already runs in a Web Worker.
  "Shiki always mounted" was false.
- **"Lazy-load Image on first use" is mechanically impossible** — `ImageAddon`
  must be loaded *before* an image escape sequence arrives, or the image is
  dropped. `Serialize`/`Search` are deferrable but minify to ~10–15 kB gzip and
  add async to the per-terminal hot path.

## Why it was deferred (the default-tab caveat)

`DEFAULT_RIGHT_PANEL_PER_TERMINAL.activeTab` is **`"code"`**, and the desktop panel
is open by default. So on a typical desktop session the Code tab is shown
immediately — meaning CodeTab loads anyway, just deferred *async past first paint*
rather than skipped. The "terminal-only users never parse 171 kB" framing holds
only for **mobile (drawer closed)** and **collapsed-panel desktop** — a minority
of sessions.

What remains for the common desktop case is a **trade**: a 23%-smaller *critical*
bundle (faster terminal first-paint, every load) against a brief Code-tab
"Loading…" flash on a **cold** load (first visit / post-deploy; warm cache hides
it via the browser-cached chunk). Whether the faster first-paint outweighs the
cold flash *perceptually* is exactly the cold-start TTI the map flags as
**untraced**. Shipping it would be a speculative bet on an unmeasured perceptual
win at the cost of a visible regression on the default surface — so it's deferred.

## The durable lessons (if revisited)

- **Defer the lazy boundary past `onMount`.** Because the default tab is `code`,
  rendering the lazy component during the *first synchronous render* suspended the
  initial paint and **hung the whole app** (observed failing, then fixed, on a pu
  box — `code-tab.feature` 0/115 → 115/115). Any future lazy-load of a
  default-visible surface must flip its mount latch after `onMount` so first paint
  completes first.
- **Wrap the lazy import in an `ErrorBoundary`.** A post-deploy stale-chunk 404
  *rejects* the dynamic import, which `Suspense` does **not** catch — route it to
  the existing reload affordance (`useSurfaceApp().reload()`).

## To unblock it later

1. **Trace cold-start TTI** on a real device (LCP/INP) — does the smaller critical
   bundle beat the cold flash?
2. **Decide the default tab** — defaulting to Inspector would turn the deferral
   into a real "never load" win for terminal-first sessions; a UX decision of its
   own.
3. Or **preload the chunk on idle** (`requestIdleCallback` after first paint) —
   keep it off the synchronous critical path *and* avoid the flash, at the cost of
   more machinery.

The full implementation (lazy CodeTab wrapper + `onMount`-deferred latch +
ErrorBoundary + keep-alive, lens/codex/simplify/police-reviewed, e2e 115/115)
lives on the closed [PR #1468](https://github.com/juspay/kolu/pull/1468) branch
`perf/bundle-startup-weight` if it's worth revisiting.
