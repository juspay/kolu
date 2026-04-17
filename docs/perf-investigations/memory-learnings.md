# Kolu memory-leak investigations

Consolidated notes from every memory-pathology hunt in kolu. Two chapters
so far. **Both wrong turns and right ones are preserved** — the history
encodes lessons the code alone doesn't. Master tracking issue: [#610](https://github.com/juspay/kolu/issues/610).

---

## Core lesson: reason from measurement

Two multi-day investigations produced this same takeaway. The spec-
reasoning fix attempts were plausible and wrong. The measurement-based
fixes found the real pathology in minutes.

- [#594](https://github.com/juspay/kolu/pull/594) argued from xterm source + WebGL spec:
  _"xterm's `webglcontextlost` listener calls `preventDefault()` → browser
  attempts restoration → we get a zombie context. Fix: dispose before
  loseContext so the listener is unregistered first."_ Plausible, but
  **wrong** — it regressed prod GPU to 1.1 GB within minutes of real
  use. The code paths being reasoned about were silently no-ops.
- [#596](https://github.com/juspay/kolu/pull/596) looked at `WeakRef.deref()` on a dev snapshot,
  saw the canvas was `<canvas class="xterm-link-layer">` (wrong canvas),
  changed the selector to `:not(.xterm-link-layer)`, and shipped.

**If you find yourself about to write "probably", "likely", "should",
or "I think", stop. Get the next measurement first.** A PR description
grounded in hypothesis is indistinguishable from one grounded in
evidence after three days — including to yourself.

---

## Tools

### Chrome Task Manager (ground truth for footprint)

`Tabs & extensions` view. Three columns to read together:

| Column              | What it measures                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `Memory Footprint`  | Whole tab process memory: JS + GPU + renderer baseline + detached-bitmap native + V8 code cache |
| `GPU Memory`        | Textures, render buffers, compositor layers. WebGL contexts land here.                          |
| `JavaScript Memory` | `total (N live)` — the `live` parenthetical is post-GC. Use `live`, not `usedJSHeapSize`.       |

`performance.memory.usedJSHeapSize` (what the Diagnostic dialog's
`jsHeap.usedMB` shows) is a pre-GC number. It can be 3–4× the Task
Manager `live` count. Forcing a major GC drops it to `live` — the gap
is collectable garbage, not a leak.

### Diagnostic info dialog (command palette → Debug → Diagnostic info)

Copy JSON gives per-terminal state, JS heap, and the WebGL lifecycle
ledger. Key fields added across investigations:

- #592 — JS heap, DOM count, canvas count
- #595 — WebGL lifecycle (`totalCreated`, `disposed`, `aliveInDom`,
  `aliveDetached`, `gced`, `contextsLost`) + event tape per canvas
- #605 — per-terminal `bufferBytes` (actual `Uint32Array.byteLength`),
  `aliveCanvases` (per-canvas pixel-buffer sizes, detached state)
- #607 — `window.__kolu.lifecycle()` exposes `{ mounts, cleanups }`
  for the disposal-audit pattern

### `window.__kolu` dev-only console hook

Installed in dev mode via `packages/client/src/debug/consoleHooks.ts`.
From the browser console:

```js
__kolu.webgl(); // full WebGL lifecycle snapshot
__kolu.bufferBytes("terminal-id"); // xterm's primary + alt buffer bytes
__kolu.atlas("terminal-id"); // WebGL atlas dimensions
__kolu.lifecycle(); // { mounts, cleanups } for Terminal.tsx
```

### Heap-snapshot analyzers

Three Node scripts in `docs/perf-investigations/scripts/`:

| Script                  | When to run                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `count-rn.mjs`          | First check — histogram of xterm internal classes (`Rn`, `Dl`, `Qt`, `xr`, `yn`, `debouncedFit`). If counts grossly exceed live terminal count → retention. |
| `check-yn-disposed.mjs` | **Distinguishes the two leak shapes** — distribution of `yn._store._isDisposed`. If all retained are `true`, cleanup ran; leak is post-dispose.             |
| `orphan-paths.mjs`      | BFS from GC roots to every orphaned `Rn`, grouped by path signature. The analyzer that definitively identifies the pin.                                     |

Run as `node --max-old-space-size=8192 script.mjs path/to/snapshot.heapsnapshot`.

Chrome's `take_memory_snapshot` (chrome-devtools MCP) forces a major GC
before capturing — so snapshots always reflect the live set.

---

## Two leak shapes

Distinguish these on every investigation:

| Shape                                | Signal                                                                                            | Fix pattern                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Cleanup doesn't run**              | `mounts > cleanups + live` via `__kolu.lifecycle()`; orphan entry's event tape has only `create`. | Register `onCleanup` synchronously before any `await`; bail post-await (see #598). |
| **Cleanup runs but memory retained** | `__kolu.lifecycle()` matches; `yn._store._isDisposed=true`; `Rn` count high.                      | Null out captured refs in component scope (#607) or register disposables (#609).   |

---

## Chapter 1 — [#591](https://github.com/juspay/kolu/issues/591): WebGL zombie contexts (6 attempts)

Symptom: tab growing 300 MB → 2 GB over hours with `WARNING: Too many
active WebGL contexts. Oldest context will be lost.` Chrome's per-tab
budget is ~16.

| #   | PR                                              | Claim                                                                                                                                                                                                                                                                 | Outcome                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [#578](https://github.com/juspay/kolu/pull/578) | Only the focused+visible tile holds a `WebglAddon`; add explicit `loseContext()` on dispose.                                                                                                                                                                          | Correct design. But two latent bugs — a wrong canvas selector (#596) and an async-onMount race (#598) — made both mechanisms silently no-ops. Nobody noticed for weeks because warnings only surfaced after hours of accumulation.                          |
| 2   | [#592](https://github.com/juspay/kolu/pull/592) | Expose JS heap / DOM / canvas / atlas counts in the Diagnostic info dialog.                                                                                                                                                                                           | First step toward factual observation. Not a fix.                                                                                                                                                                                                           |
| 3   | [#594](https://github.com/juspay/kolu/pull/594) | Swap order inside `unloadWebgl`: `dispose()` before `loseContext()`, so xterm's `webglcontextlost` listener is unregistered before the event fires.                                                                                                                   | **Regressed** — GPU climbed to 1.1 GB within minutes. Closed unmerged. The whole reasoning chain was spec-based; the listener existed but was never receiving events on the canvas the code was calling `loseContext()` on.                                 |
| 4   | [#595](https://github.com/juspay/kolu/pull/595) | `webglTracker` — WeakRef-based ledger with `aliveDetached`, `contextsLost`, event tape per canvas.                                                                                                                                                                    | The instrument that made the next two fixes possible. First runtime data from prod confirmed `contextsLost: 0` despite `loseContext-called: 8` — the explicit release had never been happening.                                                             |
| 5   | [#596](https://github.com/juspay/kolu/pull/596) | `.xterm-screen canvas` was matching xterm's link-layer canvas first (document order), so `getContext("webgl2")` returned null and the `loseContext()` chain short-circuited. Fix: `:not(.xterm-link-layer)`.                                                          | Found in minutes once a heap snapshot showed the `WeakRef` target was the wrong canvas. GPU dropped. JS heap kept creeping during mode toggles (→ #598).                                                                                                    |
| 6   | [#598](https://github.com/juspay/kolu/pull/598) | `onCleanup` was registered inside `onMount`'s async body, **after** `await document.fonts.load(...)`. Canvas↔focus mode toggles disposed the reactive owner during the await; `onCleanup` in a disposed owner is a silent no-op. Each race orphaned a whole Terminal. | Diagnosed by walking heap-snapshot `Entry` objects: orphans had only `{kind: "create"}` in their event tape — `unloadWebgl` never ran for them. Fix: register `onCleanup` synchronously at component-body top with a `disposed` flag the async body checks. |

Also landed: [#600](https://github.com/juspay/kolu/pull/600) — `@solid-primitives/resize-observer`'s
internal `onCleanup` wrapped in `runWithOwner` so it registers on the
component's cleanup list.

---

## Chapter 2 — [#606](https://github.com/juspay/kolu/issues/606): mode-toggle retention leak

After Chapter 1, focus-swaps were clean but Focus↔Canvas toggles still
leaked. 6 toggles with 4 terminals retained 24/28 xterm Terminals
post-forced-GC. Two independent root causes — both in the "cleanup
runs but memory retained" shape, both found via heap-snapshot
BFS-from-root.

### Cause A — Kolu-side ([#607](https://github.com/juspay/kolu/pull/607))

The container `<div data-terminal-id="…">` has
`onClick={() => terminal?.focus()}`. Solid attaches this as
`div.$$click` via delegated events. The closure's V8 Context is
Terminal.tsx's component body — same Context as `terminal`, `fitAddon`,
`searchAddon`, `webgl`, `scrollLock`.

`onCleanup` previously nulled `terminal` and `webgl` but not `fitAddon`
or `searchAddon`. xterm addons hold `_terminal` back-pointers, so:

```
live <div> --$$click--> closure --context--> Terminal Context
  --slot[fitAddon]--> FitAddon
  --property:_terminal--> xterm Terminal (Rn)
  ...whole xterm graph
```

Fix: three lines in `onCleanup` — null `fitAddon`, call
`setSearchAddon(null)`, cancel the pending `requestAnimationFrame`.
`serializeAddon` is a function-local inside `onMount`'s
`runWithOwner` — released when `unregisterTerminalRefs` removes the
entry.

Result: **24 → 6** orphans.

### Cause B — xterm-side ([#609](https://github.com/juspay/kolu/pull/609) + upstream [xtermjs/xterm.js#5817](https://github.com/xtermjs/xterm.js/pull/5817) / [#5818](https://github.com/xtermjs/xterm.js/issues/5818))

The 6 Kolu-side survivors all shared one retainer chain ending in
xterm-internal code:

```
DOMTimer → ScheduledAction → V8Function
  → CursorBlinkStateManager._renderCallback → WebglRenderer → Terminal
```

Three dispose-registration gaps in xterm:

1. `addon-webgl/WebglRenderer._cursorBlinkStateManager` declared
   `= new MutableDisposable()` without `this._register(...)`. Its
   `setInterval` for the cursor blink survived `dispose()`, pinning
   the renderer via `_renderCallback`. Every sibling
   `MutableDisposable` in that class has the `_register` wrapper;
   this one was the exception.
2. `common/TaskQueue.DebouncedIdleTask` had no `dispose()` method at
   all.
3. `browser/services/RenderService._pausedResizeTask` (a
   `DebouncedIdleTask`) not registered.

Fix: 6-line source patch (upstream PR #5817), delivered downstream via
`juspay/xterm.js` fork at `fix/dispose-leaks-built` — branch commits
the `.ts` source fix **and** pre-built `.mjs` bundles so pnpm can
consume it directly via `github:...&path:...` override, no install-
time build step.

Result: **6 → 0** orphans.

### Post-fix numbers

| Stage                                                                                                       | Rn    | yn disposed-retained |
| ----------------------------------------------------------------------------------------------------------- | ----- | -------------------- |
| Pre-any-fix (after forced GC)                                                                               | 29    | 24                   |
| After [#607](https://github.com/juspay/kolu/pull/607) only                                                  | 11    | 6                    |
| **After [#607](https://github.com/juspay/kolu/pull/607) + [#609](https://github.com/juspay/kolu/pull/609)** | **5** | **0**                |

The residual 1 Rn above live count is a transitional instance —
freshly created during restore, pending final GC after the latest
allocation pressure.

### Minified class mapping (dev build)

- `Rn` — xterm `Terminal` (thin wrapper; real state in `_core: yn`)
- `yn` — xterm `CoreBrowserTerminal`
- `Dl` — xterm `InputHandler`
- `Qt` — xterm `WebglAddon`
- `xr` — xterm `WebglRenderer` (correctly ≤1 at a time — focused tile)
- `Ht` — xterm `CursorBlinkStateManager` (addon-webgl; Chapter 2's
  leak site)
- `tE` / `lU` — xterm `CharSizeService` / `AtlasPage`
- `dr2` — xterm `DisposableStore`
- `debouncedFit` — closure defined in `Terminal.tsx`

Class names shift between xterm versions — verify by inspecting
property shape (e.g. an object with `_animationTimeRestarted` +
`isCursorVisible` + `_renderCallback` is `CursorBlinkStateManager`).

---

## WebGL lifecycle invariants

Healthy steady-state:

- `totalCreated - disposed == aliveInDom == 1` — only the focused tile
  is undisposed.
- `contextsLost == aliveDetached` — every detached canvas's GPU is
  released.
- Every `contextlost` event in the tape has `defaultPrevented: false`
  — xterm's context-restoration listener was torn down by
  `w.dispose()` before the async event dispatched.

Violation patterns:

| Violation                                                                 | Diagnosis                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `totalCreated - disposed > 1` and orphan tape has only `{kind: "create"}` | Async-onMount cleanup race — another `await` before `onCleanup(...)` registers. Fix: #598.  |
| `aliveDetached > contextsLost`                                            | `loseContext()` isn't firing. Check canvas selector (#596) or xterm preventDefault.         |
| `yn._store._isDisposed=true` for retained Rn                              | Cleanup runs, memory retained externally. Likely #607 / #609 shape. Run `orphan-paths.mjs`. |
| `contextlost` with `defaultPrevented: true` time-adjacent to active use   | xterm's listener ran before disposal — schedules a 3 s restoration timer.                   |

---

## Reproduction recipes

Focus swaps alone rarely leak. What does:

| Scenario                                              | Triggers                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Canvas ↔ focus mode toggle                            | Full subtree replacement via `<Show>`. Dominant #598 and #606 reproduction.             |
| Terminal close (`×` + confirm, or `Ctrl+D` via shell) | Server pushes removal → `<For>` unmounts the tile → Terminal disposes.                  |
| `Ctrl+Enter` + `Ctrl+D` rapid-fire                    | Stresses the `await document.fonts.load` window.                                        |
| 20× `Ctrl+Enter`+`Ctrl+D`                             | Good regression test. Pre-#598 reproduces ~6 orphans per cycle; post-#598 reproduces 0. |
| 6× Focus↔Canvas toggle with 4 terminals               | Chapter 2 repro. Pre-#607+#609: 24 orphan Terminals. Post-fix: 0.                       |

---

## The async-onMount cleanup race (generalizable)

If you see this shape anywhere in SolidJS code:

```ts
onMount(async () => {
  await somethingAsync();
  createExpensiveResource(); // allocates GPU / native / etc
  onCleanup(() => disposeResource()); // ← silent no-op if already disposed
});
```

...and the component can be unmounted during the `await` (via `<Show>`
toggle, `<For>` key change, parent re-render), you have a leak.
`onCleanup` inside a disposed reactive owner is a **silent no-op**.

Fix shape:

```ts
let disposed = false;
onCleanup(() => {
  disposed = true;
  disposeResource(); // handle null case: await never completed
});

onMount(async () => {
  const owner = getOwner(); // capture before await
  await somethingAsync();
  if (disposed) return;
  runWithOwner(owner, () => {
    // so library-internal onCleanup
    createExpensiveResource(); //   calls register on our list
  });
});
```

Catalogued under "Async-initialization cleanup registration" in
`agents/.apm/instructions/lowy-volatilities.instructions.md`.

---

## Part 2 — next chapter (after #609 deploy)

Production data from the #607-only build showed footprint still
climbing ~1 GB/hour with the WebGL ledger clean (`aliveDetached: 0,
gced: 99/99`). Remaining growth is not a disposal-leak signature —
it's V8 heap retention + native backing stores + possibly xterm glyph
atlas accumulation. Tracked in [#610](https://github.com/juspay/kolu/issues/610).

---

## Pointers

- Source: `packages/client/src/terminal/webglTracker.ts` (ledger),
  `packages/client/src/terminal/Terminal.tsx` (`loadWebgl`/`unloadWebgl`,
  lifecycle counters), `packages/client/src/debug/consoleHooks.ts`
  (`__kolu` hook), `packages/client/src/DiagnosticInfo.tsx` (dialog).
- Scripts: `docs/perf-investigations/scripts/{count-rn,check-yn-disposed,orphan-paths}.mjs`.
- Skill: `agents/.apm/skills/perf-diagnose/SKILL.md`.
- Upstream: juspay/xterm.js fork + xtermjs/xterm.js#5817 / #5818.
- Master tracking: [#610](https://github.com/juspay/kolu/issues/610).
