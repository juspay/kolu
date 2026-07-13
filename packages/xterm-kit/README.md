# @kolu/xterm-kit

High-level machinery over [xterm.js](https://github.com/xtermjs/xterm.js) —
graduated out of kolu's client and kaval so the hazards live in one owned,
version-pinned place. It is **not** a fork of xterm: it speaks bytes, buffers,
and `Terminal` objects, and knows nothing about a PTY, a host, a wire frame, or a
keybinding. The plan of record and API design is the Atlas note
[xterm-kit](../../docs/atlas/src/content/atlas/xterm-kit.mdx).

Two entrypoints, matching two consumers:

## `@kolu/xterm-kit` — the runtime-neutral core

Works on a browser `@xterm/xterm` `Terminal` **or** an `@xterm/headless` one. No
`solid-js`, so a Node daemon (kaval) imports it without vendoring a UI framework
— a guarantee pinned by `noSolidInDaemon.test.ts`.

- `createMirrorAnchor` / `snapToWrapHead` — absolute mirror-line coordinates that
  survive scrollback eviction and a RIS buffer swap (the bookkeeping lifted from
  kaval's `ptyHost`).
- `createBackfillController` / `prependScrollback` — scroll-triggered in-place
  scrollback backfill; the fail-loud buffer surgery under it.
- `createSnapshotBoundary` — first-frame-is-snapshot vs. live-delta
  discrimination for a reattaching stream.
- `defaultScratch` / `isAltBufferActive` — the scratch-terminal factory and the
  alt-buffer read the controller leans on.

## `@kolu/xterm-kit/internals` — the single door to `_core.*`

Cosmetic reads that **degrade to `null`** when a pinned private symbol moves (a
render-service probe, a DEC-mode read, per-buffer byte counts, the
transform-aware pointer→cell mapping). The opposite philosophy from the core's
buffer mutations, which **throw** — both pinned by contract tests.

## `@kolu/xterm-kit/solid` — the SolidJS browser adapter

- `Xterm` / `createXtermLifecycle` — the component and its owner-correct
  async-dispose primitive.
- `attachWebGL` / `createRenderRecovery` — WebGL context-loss recovery and forced
  repaint when the rAF loop parks.
- `createScrollLock` / `wireScrollIntent` — freeze-while-reading latch and its DOM
  wiring.
- `enableSoftKeyboardInput` / `wireTouchTaps` / `wireTouchScroll` — the mobile
  touch surface xterm 6.0 ships none of.
