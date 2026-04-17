---
name: perf-diagnose
description: Diagnose Kolu client-side performance issues (memory leaks, high GPU, slow interactions) using chrome-devtools MCP + the Debug → Diagnostic info dialog. Triggers on "memory leak", "GPU memory", "tab bloat", "why is kolu slow", "debug performance", "zombie canvas", "WebGL leak", or any #591-shaped issue.
---

# Performance diagnosis

## Ground rule: facts over guesses

**Every claim must cite evidence from a live measurement: Chrome Task Manager screenshot, Diagnostic-info JSON, or a parsed heap snapshot.** No reasoning from xterm source, no reasoning from WebGL spec, no "probably" or "I suspect". PR [#594](https://github.com/juspay/kolu/pull/594) regressed production to 1.1 GB GPU because its fix was reasoned from spec reading without runtime verification — the same code paths the author was reasoning about were silently no-ops. The [#595](https://github.com/juspay/kolu/pull/595) `webglTracker` exists so you can stop guessing.

If you find yourself about to write "probably", "likely", "should", or "I think", stop. Get the next measurement first. If you write a PR description based on a hypothesis, the reader can't tell which parts were observed vs invented; neither can you three days later.

## Prerequisites

Need chrome-devtools MCP and a running dev server on `http://localhost:5173`. If the dev server isn't running, **ask the user before continuing** (via `AskUserQuestion`): "Start `just dev` in a terminal? Required to reproduce memory pathologies with the tracker attached." Don't silently run it — it ties up a terminal.

## The three signals

Always triangulate with all three:

1. **Chrome Task Manager** (user shares screenshot). Three columns matter: `Memory Footprint`, `GPU Memory`, `JavaScript Memory live/total`. The "live" JS number is post-GC — use it, not `usedJSHeapSize`.
2. **Debug → Diagnostic info dialog** (command palette → Debug → Diagnostic info → Copy JSON). Gives per-terminal state, JS heap, and the **WebGL lifecycle** section: `totalCreated`, `disposed`, `aliveInDom`, `aliveDetached`, `gced`, `contextsLost`. Events tape has the last 30 `create / loseContext-called / dispose / contextlost / contextrestored` events with `defaultPrevented` flags.
3. **Heap snapshot** via `mcp__chrome-devtools__take_memory_snapshot` to `/tmp/kolu.heapsnapshot`. Chrome forces a major GC before capturing.

## WebGL invariants

If the Diagnostic dialog shows any of these, something is wrong:

- `aliveDetached > 0 && contextsLost < aliveDetached` — canvases held alive with **live** WebGL contexts. This is the #591 leak shape.
- `totalCreated - disposed > aliveInDom` — orphan entries whose `onCleanup` never fired. Events tape for an orphan contains only `{kind: "create"}`. Usually an async-onMount-cleanup-race (fixed in #598; if it resurfaces, look for another `await` before `onCleanup(...)` registers).
- `contextlost` events with `defaultPrevented: true` but disposal happened seconds earlier — xterm's context-restoration listener is running and allocating new GL state on a detached canvas. That's a zombie-regen pattern.

Healthy steady-state: `contextsLost == aliveDetached` (every zombie's GPU released) and `totalCreated - disposed == aliveInDom` (only the active tile is undisposed).

## Reproduction recipe

Focus swaps alone rarely leak. What does:

1. **Canvas ↔ focus mode toggles** — `<Show>` re-creates all Terminal component subtrees. Rapid toggling during async-onMount was #591's dominant trigger.
2. **Create + close churn** — `Ctrl+Enter` to create, click the × button + confirm OR `Ctrl+D` to close. Short cycles stress the onMount/onCleanup race window.
3. **Rapid-focus across many tiles** — needs ~10+ tiles in canvas mode to expose context-budget pressure.

Combine all three over ~2 minutes of scripted churn before reading the dialog.

## Heap snapshot analysis (no Python on Nix devshell — use Node)

Heap snapshots are big JSON. Parse with Node:

```js
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
const { nodes, edges, strings } = data;
const nodeTypes = data.snapshot.meta.node_types[0];   // ['hidden','array','string','object','code','closure',...,'native',...]
const edgeTypes = data.snapshot.meta.edge_types[0];   // ['context','element','property','internal','hidden','shortcut','weak']
// node_fields: [type, name, id, self_size, edge_count, detachedness]
// edge_fields: [type, name_or_index, to_node]
```

Useful queries:

- **Detached canvases**: iterate nodes, filter `type === 'native'` and `name` starts with `<canvas`, bucket by `detachedness` (1=attached, 2=detached, 0=unknown).
- **webglTracker entries**: iterate `type === 'object'` nodes whose properties include `canvasRef + disposedAt + loseContextCalledAt`. Check `disposedAt` type: `'hidden'` = null (undisposed), `'number'` = disposed. Follow `canvasRef`'s `weak` edge to the canvas target.
- **Retainer chain**: build reverse-edge map (parent lookups), walk up from a leaked node. Filter out `synthetic` `(Traced handles)` and browser-internal `(Client heap)` edges — real retainers are `property` or `element` edges from `object`/`closure`/`array` nodes.

Production bundles are minified; xterm class names appear as `yg`, `e3`, etc. Recognize by property shape (e.g. an object with a `canvas` property pointing to a 512×512 canvas is a `TextureAtlasPage`).

## Interpreting the gap

Tab `Memory Footprint` = JS live + GPU + renderer baseline + **detached DOM bitmap memory** (native). Last bucket is invisible to both JS heap and GPU counters. Rough budget for Kolu:

- 1 live WebGL context ≈ 30 MB GPU
- Compositor layers for N canvas-mode tiles ≈ N × 20–30 MB GPU
- Chrome renderer baseline ≈ 100–150 MB
- Everything else = detached DOM or V8 code/isolate

If JS heap is collectable (forced GC drops it) and WebGL invariants are clean, remaining footprint is either V8 lazy GC or detached-bitmap lag — benign unless it grows unbounded over hours.

## Chrome Task Manager vs `performance.memory`

- `performance.memory.usedJSHeapSize` = bytes allocated, includes uncollected garbage. Grows between GCs.
- Task Manager `JavaScript Memory (N live)` = live set after last major GC. Use this for steady-state.

The gap between them is collectable garbage, not a leak.

## Quick manual GC

User can force a major GC from DevTools → Memory tab → trash-can icon, or by taking a heap snapshot (Chrome always GCs before capture). If `performance.memory.usedJSHeapSize` drops sharply after that, the "growth" was just lazy collection.

## Prior art

- #591 — the original memory issue
- #592 — diagnostic dialog (JS heap, DOM, per-terminal buffer/scrollback, WebGL atlas dims)
- #594 — spec-reasoning fix that regressed; closed unmerged
- #595 — webglTracker WeakRef-based lifecycle ledger
- #596 — querySelector fix: target WebGL canvas, not xterm-link-layer
- #598 — async-onMount cleanup race (the root cause after all the above)
