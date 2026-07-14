# @kolu/xterm-kit

High-level machinery over [xterm.js](https://github.com/xtermjs/xterm.js) —
graduated out of kolu's client and kaval so the hazards live in one owned,
version-pinned place. It is **not** a fork of xterm: it speaks bytes, buffers,
and `Terminal` objects, and knows nothing about a PTY, a host, a wire frame, or a
keybinding. The plan of record and API design is the Atlas note
[xterm-kit](../../docs/atlas/src/content/atlas/xterm-kit.mdx).

**Four entrypoints**, each owning its own dependency so a consumer pulls only
what it can run. kaval (a Node daemon) imports the runtime-neutral root; the
client imports all four.

## `@kolu/xterm-kit` — the runtime-neutral core (the root)

Works on a browser `@xterm/xterm` `Terminal` **or** an `@xterm/headless` one.
Imports no `solid-js` and constructs no concrete terminal, so a Node daemon
imports it without vendoring a UI framework and without the static `@xterm/xterm`
named import that crashes Node's cjs-module-lexer under tsx — both pinned by
`noSolidInDaemon.test.ts`.

- `createMirrorAnchor` / `snapToWrapHead` — absolute mirror-line coordinates that
  survive scrollback eviction and a RIS buffer swap (the bookkeeping lifted from
  kaval's `ptyHost`). The only core piece the headless daemon consumes.
- `createSnapshotBoundary` — first-frame-is-snapshot vs. live-delta
  discrimination for a reattaching stream.

## `@kolu/xterm-kit/backfill` — in-place scrollback backfill (browser-only)

Split out of the root because it **constructs `@xterm/xterm` scratch terminals**
— daemon-hostile, so kaval never loads it.

- `createBackfillController` / `prependScrollback` — scroll-triggered older-history
  backfill and the fail-loud buffer surgery under it.
- `defaultScratch` / `isAltBufferActive` — the scratch-terminal factory and the
  alt-buffer read the controller leans on.

## `@kolu/xterm-kit/internals` — the fail-soft door to `_core.*`

Cosmetic reads that **degrade to `null`** when a pinned private symbol moves (a
render-service probe, a DEC-mode read, per-buffer byte counts, the
transform-aware pointer→cell mapping). It is the *null-guarded* `_core` door; the
two *fail-loud* reaches — `createMirrorAnchor` (core) and the backfill surgery
(`/backfill`) — take the **opposite** philosophy and **throw**, because a partial
buffer mutation corrupts a terminal. All three are pinned by contract tests, and
a `_core.buffers.normal` rename touches all three in tandem.

## `@kolu/xterm-kit/solid` — the SolidJS browser adapter

- `<Xterm>` — the whole hazard set as one JSX element: it composes every
  primitive below and owns their reactive lifetime, handing the consumer a live
  `XtermHandle` in `onReady` (inside the reactive owner) to wire its own policy —
  the stream, keybindings, the PTY, diagnostics. Kolu's `Terminal.tsx` is
  consumer #1.
- `createXtermLifecycle` — owner-correct async construction + disposal: capture
  the owner before the font `await`, bail on a `disposed` flag, re-enter with
  `runWithOwner`, and dispose term + addons synchronously. The one home for the
  #591/#606 leak choreography.
- `attachWebGL` — single-owner `WebglAddon` lifetime with context-loss recovery
  and an explicit `loseContext()` on unload; the renderer gate is an
  `Accessor<boolean>` (budget policy stays the consumer's).
- `wireTouchTaps` / `wireTouchScroll` — the mobile touch surface xterm 6.0 ships
  none of: tap-vs-scroll discrimination (with the iOS soft-keyboard focus rules)
  and the touch → scrollback bridge. What a tap *means* is the consumer's `onTap`.
- `createScrollLock` / `wireScrollIntent` — the freeze-while-reading latch and its
  DOM wiring.
- `createRenderRecovery` — forced synchronous repaint when the rAF paint loop
  parks under occlusion.
- `enableSoftKeyboardInput` / `isCoarsePointer` — the touch soft-keyboard surface
  and its coarse-pointer gate.
