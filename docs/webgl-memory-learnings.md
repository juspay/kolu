# WebGL memory learnings ([#591](https://github.com/juspay/kolu/issues/591))

Notes from a multi-day investigation of the Kolu tab growing past 1 GB over a normal session. Two of the five fix attempts were wrong; the right two came from observing runtime state instead of reasoning from xterm source. The history is preserved here because the _wrong_ turns encode lessons that the code doesn't.

## The symptom

Users reported the kolu@pureintent tab growing from ~300 MB to ~2 GB over hours of use, with console warnings:

```
WARNING: Too many active WebGL contexts. Oldest context will be lost.
WebGL: INVALID_OPERATION: delete: object does not belong to this context
webglcontextlost event received
webglcontextrestored event received
```

Chrome's per-tab WebGL-context budget is ~16. Past that, the browser evicts the oldest.

## Attempt history

| # | PR | What it claimed to fix | What actually happened |
| --- | --- | --- | --- |
| 1 | [#578](https://github.com/juspay/kolu/pull/578) | Only the focused+visible tile holds a `WebglAddon`; add explicit `loseContext()` on dispose. | Correct design. But two latent bugs — a wrong canvas selector and an async-onMount race — made both mechanisms silently no-ops in production. The leak continued; nobody noticed for weeks because the warnings only surfaced after hours of accumulation. |
| 2 | [#592](https://github.com/juspay/kolu/pull/592) | Expose JS heap / DOM / canvas / atlas counts in the `Debug → Diagnostic info` dialog. | First step toward factual observation. Not a fix. |
| 3 | [#594](https://github.com/juspay/kolu/pull/594) | Swap the order inside `unloadWebgl`: `dispose()` before `loseContext()`, so xterm's `webglcontextlost` listener is unregistered before the event fires, avoiding `preventDefault`-driven restoration. | **Regressed**. GPU climbed to 1.1 GB (nearly 2× pre-fix peak) within minutes of real use. The whole reasoning chain was spec-based: the listener existed but was never receiving events on the canvas the code was calling `loseContext()` on. Closed unmerged. Lesson: _reasoning from source isn't observation_. |
| 4 | [#595](https://github.com/juspay/kolu/pull/595) | `webglTracker` — a WeakRef-based ledger with `aliveDetached`, `contextsLost`, and an event tape per canvas. Surfaced in the diagnostic dialog. | The instrument that made the next two fixes possible. First runtime data from prod confirmed `contextsLost: 0` despite `loseContext-called: 8` — i.e. the explicit release had never actually been happening. |
| 5 | [#596](https://github.com/juspay/kolu/pull/596) | `.xterm-screen canvas` was matching xterm's link-layer canvas (first in document order), so `getContext("webgl2")` on it returned null and the entire `loseContext()` chain short-circuited. Narrowed to `:not(.xterm-link-layer)`. | Found in minutes once a heap snapshot on dev showed the `WeakRef` target was `<canvas class="xterm-link-layer">`. Closed the WebGL-context leak. GPU dropped; JS heap kept creeping up during mode toggles. |
| 6 | [#598](https://github.com/juspay/kolu/pull/598) | `onCleanup` was registered inside `onMount`'s async body, **after** `await document.fonts.load(...)`. Canvas↔focus mode toggles disposed the reactive owner during that await; `onCleanup` in a disposed owner is a silent no-op in SolidJS. Each race orphaned a whole Terminal component (xterm + addons + buffer + WebGL canvas). | Diagnosed by walking heap-snapshot `Entry` objects: orphans had only `{kind: "create"}` in their event tape — `unloadWebgl` never ran for them. Fix: register `onCleanup` synchronously at the component body top with a `disposed` flag that the async body checks after its await. |

## The core lesson: reason from measurement

The #594 attempt reasoned from xterm source + WebGL spec docs:

> _xterm's `webglcontextlost` listener calls `preventDefault()` → browser attempts restoration → we get a zombie context. Fix: dispose before loseContext so the listener is unregistered first._

Plausible, but **wrong** — and it made things worse in prod. The webglTracker in #595 showed the real pathology with three runtime facts that spec reading couldn't have given:

1. `contextsLost: 0` despite `loseContext-called: 8`. The explicit release wasn't happening at all.
2. Event tape had no `contextlost` DOM events. The listener was never firing.
3. `canvasRef` WeakRef target was `<canvas class="xterm-link-layer">` — the wrong canvas.

Once we looked at the actual `WeakRef.deref()` on dev, the `:not(.xterm-link-layer)` fix was obvious in minutes.

## Chrome Task Manager is the ground truth

Task Manager's `Tabs & extensions` view has three columns that matter. Always read all three together:

| Column | What it measures |
| --- | --- |
| `Memory Footprint` | Whole-tab process memory: JS + GPU + renderer baseline + detached-bitmap native memory + V8 code cache |
| `GPU Memory` | Textures, render buffers, compositor layers. WebGL contexts show up here. |
| `JavaScript Memory` | `total (N live)` — the `live` parenthetical is post-GC, use that for steady state. |

`performance.memory.usedJSHeapSize` (what the Diagnostic dialog's `jsHeapUsedMB` shows) is a pre-GC number. It can be 3-4x the Task Manager `live` count if V8 hasn't swept recently. Forcing a major GC from DevTools → Memory → trash-can icon drops it to the live number — that gap is collectable garbage, not a leak.

The diff `Memory Footprint - JS live - GPU` is often ~300–500 MB of "Chrome overhead + detached bitmaps." That's expected for a long-running SPA and isn't chaseable without a heap snapshot that explicitly enumerates detached DOM.

## webglTracker invariants

`DiagnosticInfo` dialog shows a `WebGL lifecycle` section (added in #595). Steady-state values for a healthy session:

- `totalCreated − disposed == aliveInDom == 1` — the only undisposed entry is the currently-active tile.
- `contextsLost == aliveDetached` — every detached canvas has its WebGL context released. Non-zero `aliveDetached` is fine as long as contexts are released; V8 will GC the shells under pressure.
- Every `contextlost` event in the tape has `defaultPrevented: false` — meaning xterm's context-restoration listener was torn down by `w.dispose()` before the async event dispatched.

Violations and what they mean:

| Violation | Diagnosis |
| --- | --- |
| `totalCreated − disposed > 1` and delta entries have only `{kind: "create"}` in their events | Async-onMount-cleanup-race (#598 pattern). An `await` in `onMount` before `onCleanup(...)` let the owner dispose in between. |
| `aliveDetached > contextsLost` | `loseContext()` isn't firing. Check the canvas selector (#596) or xterm's preventDefault interfering. |
| `contextlost` events have `defaultPrevented: true` and time-adjacent to active use | xterm's listener ran before disposal — will schedule a 3 s restoration timer. Not necessarily broken but worth noting. |

## The async-onMount-cleanup-race pattern

Generalizable beyond Kolu. If you see this shape in SolidJS:

```ts
onMount(async () => {
  await somethingAsync();
  createExpensiveResource();         // allocates GPU / native / etc
  onCleanup(() => disposeResource()); // ← race window
});
```

...and the component can be unmounted (via `<Show>` toggle, `<For>` key change, parent re-render) _during_ the `await`, you have a leak. `onCleanup` inside a disposed reactive owner is a **silent no-op** — the handler is pushed to a cleanup array that was already iterated at disposal. The resource is then created with no cleanup path wired.

Fix shape:

```ts
let disposed = false;
onCleanup(() => {
  disposed = true;
  disposeResource();               // handles the null case where await never completed
});

onMount(async () => {
  await somethingAsync();
  if (disposed) return;            // bail rather than allocate doomed resources
  createExpensiveResource();
});
```

The `onCleanup` registers synchronously during the component body's first reactive scope, where the owner is guaranteed valid. The `disposed` flag is the bail signal for the async body.

## Reproduction recipes

Focus swaps alone don't reproduce most of these — they don't trigger component unmounts in canvas mode (tiles stay mounted, only `props.focused` changes). What does:

| Scenario | Triggers |
| --- | --- |
| Canvas ↔ focus mode toggle | Full subtree replacement via `<Show>`. Dominant #598 reproduction. |
| Terminal close (X button + confirm, or `Ctrl+D` via shell EOF) | Server pushes removal → client removes the ID from `<For>` → that tile's Terminal unmounts. |
| `Ctrl+Enter` (new terminal) immediately followed by `Ctrl+D` | Rapid create+close stresses the `await document.fonts.load` window. |

A workload of "20× Ctrl+Enter + Ctrl+D" on dev goes from reproducing ~6 orphans per cycle (pre-#598) to 0 orphans (post-#598). Use this as the regression test.

## Tooling notes

- **chrome-devtools MCP** is the easiest way to introspect a local dev instance. `take_memory_snapshot` forces a major GC before capture, so snapshots always reflect the live set.
- **Heap snapshot parsing**: no Python on the Nix devshell; use Node. Schema is in `data.snapshot.meta` (node_fields, edge_fields, node_types). Minified production bundles mangle class names — recognize xterm objects by property shape (e.g. an object with a `canvas` property pointing to a 512×512 atlas canvas is a `TextureAtlasPage`).
- **Retainer chains**: build a reverse-edge map (node → parents). Ignore `synthetic (Traced handles)` and `native (Client heap)` edges — those are V8/browser internals. The real retention usually comes through `property` edges from plain objects.

## Pointers

- Tracker source: `packages/client/src/terminal/webglTracker.ts`
- Dialog: `packages/client/src/DiagnosticInfo.tsx`
- WebGL lifecycle functions: `loadWebgl` / `unloadWebgl` in `packages/client/src/terminal/Terminal.tsx`
- Skill runbook: `agents/.apm/skills/perf-diagnose/SKILL.md`
