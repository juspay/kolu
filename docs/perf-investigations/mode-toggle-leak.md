# Mode-toggle retention leak (issue #606)

Heap-snapshot investigation + targeted fix for the Focus↔Canvas
mode-toggle leak. Companion to the user-facing writeup in issue #606.

## TL;DR

6 Focus/Canvas toggles with 4 terminals previously left **24/28 xterm
`Terminal` instances retained** after forced GC. Terminal.tsx
`onCleanup` runs for every unmount, and xterm's internal dispose
completes (`yn._store._isDisposed === true` for all 24) — yet the
graph wasn't GC-eligible. Two independent causes:

1. Terminal.tsx didn't null `fitAddon` / `searchAddon` slots on
   cleanup; the live container `<div>`'s `onClick` closure shared a
   V8 Context with those slots, keeping the whole xterm graph
   reachable via the addons' `_terminal` back-pointers. Fixed in
   `Terminal.tsx` cleanup (-75% orphans on its own).
2. xterm's `CursorBlinkStateManager` was not registered for disposal
   in `WebglRenderer` (addon-webgl). Its `setInterval` kept running
   past dispose and pinned the renderer. Fixed via `pnpm patch` of
   `@xterm/addon-webgl`. A parallel bug in `RenderService` +
   `DebouncedIdleTask` fixed via `pnpm patch` of `@xterm/xterm`.

Combined result: **24 → 0 disposed-retained xterm Terminals** after
the full reproduction.

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

## The xterm-side leak — fixed by `pnpm patch`

After the Kolu-side fix, the 6 surviving orphans all shared this
retainer chain:

```
Window → InternalNode* → DOMTimer → ScheduledAction → V8Function
  → closure → Context → Ht._renderCallback → closure
  → Context → ui._terminal → Dl → Rn
```

`Ht` is xterm's **`CursorBlinkStateManager`** (addon-webgl), a class
that runs `setInterval`/`setTimeout` for the cursor blink animation.
It manages its own timers and has a correct `dispose()` method that
clears them.

**The xterm bug**: in `addons/addon-webgl/src/WebglRenderer.ts`, the
field is declared as:

```ts
private _cursorBlinkStateManager: MutableDisposable<CursorBlinkStateManager> = new MutableDisposable();
```

Every sibling `MutableDisposable` in that class is wrapped in
`this._register(...)` — the exception is this one. That's the
difference between having disposal propagate and leaving a pending
interval running past `WebglRenderer.dispose()`. The interval keeps
the `CursorBlinkStateManager` alive; its `_renderCallback` captures
the whole renderer, which captures the terminal.

**Secondary fix** in xterm core: `RenderService._pausedResizeTask` is
a `DebouncedIdleTask` that was not registered for disposal — same
pattern, different surface. `DebouncedIdleTask` also lacked a
`dispose()` method.

Applied as two `pnpm patch` files (matches the repo's pre-existing
pattern for `node-pty`):

- `patches/@xterm__addon-webgl@0.19.0.patch`: wraps the
  `_cursorBlinkStateManager = new MutableDisposable()` init with
  `this._register(...)`.
- `patches/@xterm__xterm@6.0.0.patch`: adds `dispose()` to
  `DebouncedIdleTask` and registers `_pausedResizeTask` in
  `RenderService`.

Both patches should be upstreamed to xterm.js as PRs. Filed as #606
follow-up.

## Post-patch numbers

| Snapshot                         | Rn    | yn disposed | yn live |
| -------------------------------- | ----- | ----------- | ------- |
| Baseline (fresh restore)         | 4     | 0           | 4       |
| After 6 toggles — pre any fix    | 29    | 24          | 4       |
| After 6 toggles — Kolu fix only  | 11    | 6           | 4       |
| After 6 toggles — **both fixes** | **5** | **0**       | **4**   |

Disposed-retained xterm Terminals: **24 → 0**. The residual 1 Rn
above live count is a transitional instance (freshly created during
restore, pending final GC after the latest allocation pressure).

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
- `Ht` — xterm `CursorBlinkStateManager` (addon-webgl; the leak site)
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
