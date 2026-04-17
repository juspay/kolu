---
name: perf-diagnose
description: Diagnose Kolu client-side performance issues (memory leaks, high GPU, slow interactions) using chrome-devtools MCP + the Debug → Diagnostic info dialog + heap-snapshot analyzers. Triggers on "memory leak", "GPU memory", "tab bloat", "why is kolu slow", "debug performance", "zombie canvas", "WebGL leak", or any #591/#606-shaped issue.
---

# Performance diagnosis

Full historical context + fix details: `docs/perf-investigations/memory-learnings.md`. Master tracking issue: [#610](https://github.com/juspay/kolu/issues/610). This file is the runbook.

## Ground rule: facts over guesses

**Every claim must cite evidence from a live measurement: Chrome Task Manager screenshot, Diagnostic-info JSON, `window.__kolu` console reading, or a parsed heap snapshot.** No reasoning from xterm source, no reasoning from WebGL spec, no "probably" / "likely" / "should".

Prior art: [#594](https://github.com/juspay/kolu/pull/594) regressed production to 1.1 GB GPU because its fix was reasoned from spec reading without runtime verification — the code paths being reasoned about were silently no-ops. The corresponding measurement-based fix ([#596](https://github.com/juspay/kolu/pull/596)) landed in minutes once someone looked at `WeakRef.deref()`.

If you find yourself about to write "probably" / "likely" / "I think", stop. Get the next measurement first. Hypothesis-based PR descriptions are indistinguishable from evidence-based ones three days later, including to yourself.

## Prerequisites

A running dev server on `http://localhost:5173` + chrome-devtools MCP. If the dev server isn't running, **ask the user before starting it** (`AskUserQuestion`): "Start `just dev` myself? Required to reproduce memory pathologies with the tracker attached." Don't silently run it — it ties up a terminal.

## The four signals (triangulate)

1. **Chrome Task Manager** (user shares screenshot). Columns: `Memory Footprint`, `GPU Memory`, `JavaScript Memory total (N live)`. The `live` parenthetical is post-GC — use it, not `usedJSHeapSize`.
2. **Debug → Diagnostic info dialog** (command palette → Debug → Diagnostic info → Copy JSON). Per-terminal state + WebGL lifecycle ledger + per-canvas sizes (#605) + per-terminal `bufferBytes` (#605).
3. **`window.__kolu` console hook** (dev only; see `packages/client/src/debug/consoleHooks.ts`):
   - `__kolu.webgl()` — WebGL lifecycle snapshot
   - `__kolu.bufferBytes("id")` — xterm's primary + alt `Uint32Array.byteLength`
   - `__kolu.atlas("id")` — WebGL atlas dimensions
   - `__kolu.lifecycle()` — `{ mounts, cleanups }` for Terminal.tsx (disposal audit)
4. **Heap snapshot** via `mcp__chrome-devtools__take_memory_snapshot` to `/tmp/kolu.heapsnapshot`. Chrome forces a major GC before capturing — snapshots reflect the live set.

## Two leak shapes — distinguish these first

Before digging into any specific retention chain, figure out which shape you have. They have different fixes.

| Shape                                             | How to tell                                                                                                                                   | Fix pattern                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Cleanup doesn't run** (#598 class)              | `__kolu.lifecycle()` shows `mounts - cleanups > live`. Orphan entry's event tape has only `{kind: "create"}` — no `dispose` event ever fires. | Register `onCleanup` synchronously before any `await`; bail with `if (disposed)` post-await. |
| **Cleanup runs but memory retained** (#606 class) | `lifecycle()` math works. `scripts/check-yn-disposed.mjs` shows all retained `yn` have `_store._isDisposed=true`. `Rn` count > live count.    | Null captured refs in component scope (#607) OR register disposables (#609).                 |

## WebGL lifecycle invariants

Healthy steady-state (`__kolu.webgl()` or Diagnostic dialog):

- `totalCreated - disposed == aliveInDom == 1` — only the focused tile.
- `contextsLost == aliveDetached` — every detached canvas's GPU released.
- Every `contextlost` event in tape has `defaultPrevented: false`.

Violation patterns:

| Violation                                                               | Diagnosis                                                                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `totalCreated - disposed > 1` + orphan tape has only `{kind: "create"}` | Async-onMount cleanup race. Look for a new `await` before `onCleanup(...)` registers. Fix pattern in #598. |
| `aliveDetached > contextsLost`                                          | `loseContext()` isn't firing. Check canvas selector (#596 pattern) or xterm preventDefault.                |
| Retained `yn._store._isDisposed=true`                                   | Cleanup runs, memory pinned externally. Run `orphan-paths.mjs` to find the pin.                            |
| `contextlost` with `defaultPrevented: true` time-adjacent to active use | xterm's listener ran before disposal — schedules a 3 s restoration timer.                                  |

## Heap-snapshot analyzers (three durable scripts)

`docs/perf-investigations/scripts/`. Run as:

```bash
node --max-old-space-size=8192 script.mjs path/to/snapshot.heapsnapshot
```

Use in order:

1. **`count-rn.mjs`** — instance-count histogram for xterm classes. If counts grossly exceed live terminal count → retention. Fastest first-check.
2. **`check-yn-disposed.mjs`** — distribution of `yn._store._isDisposed`. This single output tells you which of the two leak shapes you have. If all retained are `true`, cleanup ran and the leak is post-dispose (go to #3). If some are `false`, cleanup didn't run (look for async-onMount race).
3. **`orphan-paths.mjs`** — BFS from GC roots to every orphaned `Rn`, grouped by path signature. Prints the full retainer chain per path. This is the analyzer that definitively identifies the pin site.

Minified class names shift between xterm versions (e.g. `Ht` in one build is `CursorBlinkStateManager` in addon-webgl). Verify by outgoing-edge shape:

- `Rn` (xterm `Terminal`) — has only `_core` + `__proto__` edges; real state in `_core: yn`
- `yn` (xterm `CoreBrowserTerminal`) — has `_store`, `element`, `_inputHandler`, many services
- `CursorBlinkStateManager` — has `_renderCallback`, `isCursorVisible`, `_animationTimeRestarted`, `_animationFrame`
- `TextureAtlasPage` — has a `canvas` property pointing at a 512×512 canvas

## Reproduction recipes

Focus swaps alone rarely leak. What does:

| Scenario                                         | Triggers                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| **6× Focus↔Canvas mode toggle** with 4 terminals | The canonical Chapter-2 repro. Pre-#607+#609: 24 orphans. Post-fix: 0. |
| Terminal close (`×` + confirm, or `Ctrl+D`)      | Server removal → `<For>` unmounts the tile → Terminal disposes.        |
| `Ctrl+Enter` + `Ctrl+D` rapid-fire               | Stresses the `await document.fonts.load` window in onMount.            |
| 20× `Ctrl+Enter`+`Ctrl+D`                        | Regression test. Pre-#598: ~6 orphans per cycle. Post-#598: 0.         |

Combine over ~1–2 minutes of scripted churn before reading the dialog.

## Interpreting the gap (footprint - JS - GPU)

Task Manager `Memory Footprint` includes JS live + GPU + renderer baseline + **detached DOM bitmap native memory** + V8 code cache. The last bucket is invisible to both JS heap and GPU counters. Rough budget for kolu:

- 1 live WebGL context ≈ 30 MB GPU
- Compositor layers for N canvas tiles ≈ N × 20–30 MB GPU
- Chrome renderer baseline ≈ 100–150 MB
- V8 "sticky" heap (`usedJSHeapSize - live`) often 300–500 MB on a long-running tab — this is V8 not returning unused heap to the OS, not a leak.
- Large canvas bitmaps (the active WebGL canvas at DPR=2 is ~15 MB) linger past JS-side disposal until Chrome's compositor recycles — native-side, invisible to our tools.

If JS heap collapses under forced GC and WebGL invariants are clean, remaining footprint is most likely benign V8/renderer retention. That's the **Part 2** territory (#610): post-disposal-leak-fixes investigation.

## Chrome Task Manager vs `performance.memory`

- `performance.memory.usedJSHeapSize` (what the dialog shows) = bytes allocated, includes uncollected garbage.
- Task Manager `JavaScript Memory (N live)` = live set after last major GC.

The gap is collectable garbage, not a leak. Force a major GC (DevTools → Memory → trash icon, or take a heap snapshot) and compare.

## When in doubt — fork xterm.js

If retention traces to an xterm-internal class (Chapter 2 pattern), the fix is likely a 1–3 line `this._register(...)` wrapper in xterm source. Pattern from #609:

1. Fork `xtermjs/xterm.js` → `juspay/xterm.js`.
2. Apply fix to `.ts` source on a `fix/xxx` branch.
3. Create a `fix/xxx-built` branch that also commits the built `.mjs` bundles (so pnpm can consume via `github:juspay/xterm.js#fix/xxx-built` without running xterm's install-time build toolchain).
4. Use `pnpm.overrides` in kolu's `package.json` pointing at the built branch.
5. Open upstream issue first, then upstream PR linking to it.

Once upstream merges + releases, the override collapses to a plain version bump in `package.json`.

## Prior art (PRs / issues cited in this skill)

- #591 — original WebGL-context accumulation report
- #592 — diagnostic dialog foundation
- #594 — spec-reasoning regression (closed unmerged); the "lesson" PR
- #595 — `webglTracker` WeakRef ledger
- #596 — wrong-canvas-selector fix (`:not(.xterm-link-layer)`)
- #598 — async-onMount cleanup race
- #600 — `runWithOwner` for `@solid-primitives/resize-observer`
- #605 — per-terminal bufferBytes + aliveCanvases
- #606 — Chapter 2 tracking issue (mode-toggle retention)
- #607 — Kolu-side `fitAddon`/`searchAddon` null-out + `window.__kolu` hook
- #609 — xterm-side patch via `juspay/xterm.js` fork
- #610 — master tracking issue for all memory work
- xtermjs/xterm.js#5817 + #5818 — upstream issue + PR
