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

## Ground truth: Task Manager `Memory Footprint`, not proxies

The ONLY metric that counts as proof of a memory-leak fix is **Chrome Task Manager `Memory Footprint`** on a fresh tab with a reproducible toggle sequence. Everything else is a proxy:

- `performance.memory.usedJSHeapSize` includes uncollected garbage and can drift 3–4× from the live set.
- `system/Context` / `closure:*` counts in a heap snapshot track SolidJS reactive-scope growth — correlate weakly with footprint. A change can reduce Context growth 89% and move footprint zero. See Chapter 3 in `memory-learnings.md`.
- `yn._isDisposed` distribution only separates two specific leak shapes; it won't catch native / DOM / GPU retention.

**Before claiming any fix works, run a fresh-tab Task Manager A/B.** Open the tab, note footprint, toggle N times, note footprint. If the Δ didn't drop, the proxy you optimized wasn't the load-bearing retention.

### Quiet-session A/B to isolate legitimate activity

A non-zero footprint Δ isn't automatically a leak. Agent terminals streaming output grow xterm scrollback buffers — that's the program doing its job. Before declaring a new leak:

1. Close or idle all streaming terminals.
2. Take the baseline on the quiet session.
3. Run the reproducer.
4. Compare.

[#618](https://github.com/juspay/kolu/issues/618) was filed on a +69 MB/30-toggles residual after #617. Quiet-session A/B showed 0 MB / 30 toggles — the +69 was all agent stream activity.

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

## Three leak shapes — distinguish these first

Before digging into any specific retention chain, figure out which shape you have. They have different fixes.

| Shape                                               | How to tell                                                                                                                                                                                                                                                                                                                                                                                                | Fix pattern                                                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cleanup doesn't run** (#598 class)                | `__kolu.lifecycle()` shows `mounts - cleanups > live`. Orphan entry's event tape has only `{kind: "create"}` — no `dispose` event ever fires.                                                                                                                                                                                                                                                              | Register `onCleanup` synchronously before any `await`; bail with `if (disposed)` post-await.                                                                                                                                  |
| **Cleanup runs but memory retained** (#606 class)   | `lifecycle()` math works. `scripts/check-yn-disposed.mjs` shows all retained `yn` have `_store._isDisposed=true`. `Rn` count > live count.                                                                                                                                                                                                                                                                 | Null captured refs in component scope (#607) OR register disposables (#609).                                                                                                                                                  |
| **Callback retained past `dispose()`** (#617 class) | `diff-heap.mjs` shows a large native class (`JSArrayBufferData`, `Uint32Array`, `SVGAnimated*`, etc.) growing. `find-retainers.mjs` traces it through a `Window.<ObserverCtor>` → Map/registry → callback closure → a disposed service object. Happens when the browser's observer registry (or a DevTools/extension wrapper) retains the callback closure past our explicit `observer.disconnect()` call. | Wrap the captured `this` in `WeakRef` inside the callback. `observer.disconnect()` stays as-is; the WeakRef is defensive for when it doesn't fully release. See #617 for the xterm `RenderService.IntersectionObserver` case. |

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

## Heap-snapshot analyzers (five durable scripts)

`docs/perf-investigations/scripts/`. Run as:

```bash
node --max-old-space-size=8192 script.mjs path/to/snapshot.heapsnapshot
```

Use in order — **start with `diff-heap.mjs`**. It runs across a baseline/post pair and names the leaking class in one line; everything after that is a targeted retainer walk on that one class.

1. **`diff-heap.mjs baseline.heapsnapshot post.heapsnapshot`** — aggregates `self_size` bytes per class in each snapshot and prints the top classes by byte growth. Sort by bytes, not count: a 220 MB `Uint32Array` leak (#617) drowns any number of 40-byte `Context` churn. First tool to reach for on any retention investigation.
2. **`find-retainers.mjs snap.heapsnapshot <type> <name>`** — BFS from GC roots to every instance of the target class, groups by retainer-path signature, prints the dominant chain. Call with the class that `diff-heap.mjs` flagged (e.g. `native Uint32Array` or `closure debouncedFit`). This identifies the pin site definitively.
3. **`count-rn.mjs`** — instance-count histogram for xterm classes (`Rn`, `Dl`, `Qt`, etc.). Useful once you've narrowed the investigation to xterm, as a quick "do the counts look sane for the live terminal count" sanity check.
4. **`check-yn-disposed.mjs`** — distribution of `yn._store._isDisposed`. Separates "cleanup doesn't run" from "cleanup runs but memory retained" (#598 vs #606). If all retained `yn` are `true`, cleanup ran and the leak is post-dispose.
5. **`orphan-paths.mjs`** — special-case of `find-retainers.mjs` pre-filtered to orphan `Rn` (disposed-but-retained xterm `Terminal`s). Use when you already know the leak is xterm-shaped.

### Rule of thumb: sort by bytes, follow the heaviest

The dominant byte-growth class is almost always the one retaining everything else through its closure chain. Fixing a small-byte class while the heaviest is still leaking gets you zero footprint improvement. Chapter 3 in `memory-learnings.md` is the full cautionary tale on this.

Minified class names shift between xterm versions (e.g. `Ht` in one build is `CursorBlinkStateManager` in addon-webgl). Verify by outgoing-edge shape:

- `Rn` (xterm `Terminal`) — has only `_core` + `__proto__` edges; real state in `_core: yn`
- `yn` (xterm `CoreBrowserTerminal`) — has `_store`, `element`, `_inputHandler`, many services
- `CursorBlinkStateManager` — has `_renderCallback`, `isCursorVisible`, `_animationTimeRestarted`, `_animationFrame`
- `TextureAtlasPage` — has a `canvas` property pointing at a 512×512 canvas

## Reproduction recipes

Focus swaps alone rarely leak. What does:

| Scenario                                            | Triggers                                                                                                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **30× Focus↔Canvas mode toggle** with 6–7 terminals | The canonical Chapter-3 repro. Pre-#617: +220 MB of `Uint32Array` (BufferLines) on native side, +367 MB Memory Footprint. Post-fix: flat. |
| **6× Focus↔Canvas mode toggle** with 4 terminals    | The canonical Chapter-2 repro. Pre-#607+#609: 24 orphans. Post-fix: 0.                                                                    |
| Terminal close (`×` + confirm, or `Ctrl+D`)         | Server removal → `<For>` unmounts the tile → Terminal disposes.                                                                           |
| `Ctrl+Enter` + `Ctrl+D` rapid-fire                  | Stresses the `await document.fonts.load` window in onMount.                                                                               |
| 20× `Ctrl+Enter`+`Ctrl+D`                           | Regression test. Pre-#598: ~6 orphans per cycle. Post-#598: 0.                                                                            |

Combine over ~1–2 minutes of scripted churn before reading the dialog.

**Always run the repro on a quiet session** (all agent terminals idle, no streaming output) for leak measurements. Active scrollback growth from live agents will inflate the Δ by tens of MB and look indistinguishable from retention. See the quiet-session A/B section above.

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
- #609 — xterm-side patch via `juspay/xterm.js` fork (CursorBlinkStateManager + \_pausedResizeTask)
- #610 — master tracking issue for all memory work
- #614 — Chapter 3's wrong turn (closed unmerged); six commits chasing `system/Context` count proxy with no Task Manager effect
- #617 — Chapter 3's fix: WeakRef in `RenderService`'s IntersectionObserver callback. Production: −81% Memory Footprint growth per 30 toggles.
- #618 — residual-leak follow-up, closed as "legitimate agent-stream activity" after quiet-session A/B
- xtermjs/xterm.js#5817 + #5818 — upstream issue + PR for #609
- xtermjs/xterm.js#5820 + #5821 — upstream issue + PR for #617
