# Mode-toggle retention leak (issue #606)

Heap-snapshot investigation + targeted fix for the Focus↔Canvas
mode-toggle leak. Companion to the user-facing writeup in issue #606.

## TL;DR

6 Focus/Canvas toggles with 4 terminals previously left **24/28 xterm
`Terminal` instances retained** after forced GC. Terminal.tsx
`onCleanup` runs for every unmount, and xterm's internal dispose
completes (`yn._store._isDisposed === true` for all 24). The residual
retention is via addon back-pointers that Terminal.tsx's Context still
held after `terminal = null`. Nulling `fitAddon` and `searchAddon`
slots in `onCleanup` cuts orphans from 24 → 6 (**-75%**). The
remaining 6 are retained by xterm-internal scheduled render callbacks
(`Ht._renderCallback` / `RenderDebouncer`), which Kolu can't fix
without patching xterm.

## Reproduction

With 4+ terminals active:

1. Baseline heap snapshot (see `scripts/count-rn.mjs`).
2. Click the Focus/Canvas toggle 6 times.
3. Trigger allocation pressure to flush GC.
4. Second heap snapshot.

Counter data available at `window.__kolu.lifecycle()` in dev mode —
`{ mounts, cleanups }`. If cleanups fall short of `mounts - live`,
some unmounts are silent.

## Numbers

| Snapshot                       | Rn  | yn disposed | yn live | note                    |
| ------------------------------ | --- | ----------- | ------- | ----------------------- |
| Baseline (fresh restore)       | 4   | 0           | 4       | Only live terminals     |
| After 6 toggles (pre-fix)      | 29  | 24          | 4       | 24 orphans, cleanup ran |
| After alloc-pressure GC (pre)  | 29  | 24          | 4       | No change — not GC lag  |
| After 6 toggles + fix          | 11  | 6           | 4       | 6 orphans remaining     |
| After 10s wait + GC (post-fix) | 11  | 6           | 4       | Not resolving — stable  |

`mounts: 28, cleanups: 24` — mathematically matches live components
(28 mounts, 24 disposals, 28-24 = 4 live). Cleanup is running for
every unmount.

## The fix (`packages/client/src/terminal/Terminal.tsx`)

The container `<div data-terminal-id="…">` has
`onClick={() => terminal?.focus()}`. Solid attaches this closure as
`div.$$click` via delegated events. The closure's Context is
Terminal.tsx's component body scope — same Context as `terminal`,
`fitAddon`, `searchAddon`, `webgl`, `scrollLock`, etc.

`onCleanup` previously nulled `terminal` and `webgl`, but not
`fitAddon` or `searchAddon`. Addons store `_terminal` back-pointers to
their owning xterm instance, so:

```
live <div> --$$click--> closure --context--> Terminal Context
  --slot[fitAddon]--> FitAddon
  --property:_terminal--> xterm Terminal (Rn)
  --property:_core--> yn (disposed but still held)
  ...whole xterm graph
```

The fix is three lines in `onCleanup`: `fitAddon = null`,
`setSearchAddon(null)`, and `cancelAnimationFrame(fitRaf)` so the
pending fit doesn't re-anchor `fitAddon`. `serializeAddon` is a
function-local `const` inside `onMount`'s `runWithOwner` — it's
released when the TerminalRefs entry is deleted by
`unregisterTerminalRefs`.

## The remaining xterm-side leak (6 of 28)

The 6 orphans that survive the Kolu-side fix all share this retainer
chain (heap-snapshot BFS from root):

```
Window → InternalNode* → DOMTimer → ScheduledAction → V8Function
  → closure → Context → object:Ht.(_renderCallback) → closure
  → Context → object:ui.(_terminal) → Dl (InputHandler) → Rn (Terminal)
```

`Ht` is xterm's `RenderService` (or `RenderDebouncer` within it) and
`ui` is the `InputHandler`'s internal peer. A pending render callback
was scheduled before dispose ran and was never cancelled, so the
scheduled `DOMTimer` keeps the whole chain alive. Waiting 10 seconds

- GC does not resolve it — the timer appears persistent, not just
  delayed.

Fixing this requires patching `RenderService.dispose` (or
`RenderDebouncer.dispose`) inside xterm.js to cancel its pending
timer. That's outside this PR's scope. Options:

- **Fork xterm.js** (`juspay/xterm.js` or `srid/xterm.js`), patch
  `RenderService.dispose`, wire through Nix. The investigation
  infrastructure here (heap scripts + `window.__kolu.lifecycle()`)
  makes the fork iteration fast.
- **Upstream a bug report + PR** to xterm.js. Slower loop, right
  thing long-term.

## Minified class mapping (dev build)

- `Rn` — xterm `Terminal` (thin wrapper; real state in `_core: yn`)
- `yn` — xterm `CoreBrowserTerminal` (the actual terminal state)
- `Dl` — xterm `InputHandler`
- `Qt` — xterm `WebglAddon`
- `xr` — xterm `WebglRenderer` (correctly ≤1 at a time — focused tile)
- `tE` — xterm `CharSizeService`
- `lU` — xterm `AtlasPage` (wraps an `OffscreenCanvas`)
- `Ge` / `D` — xterm `EventEmitter` internals
- `dr2` — xterm `DisposableStore`
- `Ht` — xterm `RenderService` (remaining leak site)
- `ui` — xterm `InputHandler` peer class
- `debouncedFit` — closure defined in `Terminal.tsx`

## Runtime debug hook

`window.__kolu` is installed in dev mode (see
`packages/client/src/debug/consoleHooks.ts`). From the browser console:

```js
__kolu.webgl(); // webglLifecycleSnapshot
__kolu.bufferBytes("terminal-id"); // per-terminal xterm buffer byteLength
__kolu.atlas("terminal-id"); // WebGL atlas dimensions
__kolu.lifecycle(); // { mounts, cleanups } — Terminal.tsx component counters
```

## Scripts

All are standalone Node programs. Run as:

```bash
node --max-old-space-size=8192 script.mjs path/to/snapshot.heapsnapshot
```

| Script                     | Purpose                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `count-rn.mjs`             | Quick histogram of Rn/Dl/Qt/xr/yn/debouncedFit instance counts.       |
| `orphan-paths.mjs`         | Root-to-Rn paths filtered to orphaned (`yn._store._isDisposed=true`). |
| `bfs-from-roots.mjs`       | Full forward BFS from GC roots; prints shortest path to each Rn.      |
| `first-external.mjs`       | Shortest non-xterm retainer of each Rn.                               |
| `analyze-leak.mjs`         | Upward retainer walk from a named class.                              |
| `check-solid-owners.mjs`   | SolidJS signal/owner counts; flags signals with many observers.       |
| `check-store-disposed.mjs` | Distribution of `dr2._isDisposed` (disposed vs live stores).          |
| `check-yn-disposed.mjs`    | Same for yn/Dl via `_store._isDisposed`.                              |
| `find-addon-leak.mjs`      | xterm addon wrappers (`{ instance, dispose, isDisposed }`) by class.  |
| `context-leak.mjs`         | Closures in a Terminal's Context + their external retainers.          |
| `enum-retainers.mjs`       | All retainers of named closures.                                      |
| `sample-signal.mjs`        | Inspects a signal's value shape + observer entries.                   |
| `target-trace.mjs`         | scrollLock objects + their retainer chains.                           |
| `trace-leaker.mjs`         | Chain up from a closure node id.                                      |
| `trace-native-bind.mjs`    | Histograms retainers of xterm's `native_bind` closures.               |
| `trace-xr.mjs`             | WebglRenderer + its surrounding addon wrappers.                       |
