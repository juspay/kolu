/** `@kolu/xterm-kit` — the runtime-neutral core.
 *
 *  Every export here works on a browser `@xterm/xterm` `Terminal` OR an
 *  `@xterm/headless` one, imports NO `solid-js`, and constructs NO concrete
 *  terminal — so a Node daemon (kaval, run from TS source under tsx) imports this
 *  root barrel without vendoring a UI framework AND without the `@xterm/xterm`
 *  ESM-named-import that crashes under Node's cjs-module-lexer. Both guarantees
 *  are pinned by `noSolidInDaemon.test.ts` (it imports this barrel exactly as the
 *  daemon does).
 *
 *  The `@xterm/xterm`-constructing backfill write path lives behind
 *  `@kolu/xterm-kit/backfill` (browser-only — it builds scratch terminals), the
 *  SolidJS adapter behind `@kolu/xterm-kit/solid`, and the cosmetic `_core.*`
 *  reads behind `@kolu/xterm-kit/internals`. Plan of record + API design: the
 *  Atlas note `xterm-kit`. */

// Mirror anchoring — absolute mirror-line coordinates that survive eviction and
// a RIS buffer swap (the bookkeeping lifted from kaval's ptyHost). The only core
// piece the headless daemon actually consumes.
export { createMirrorAnchor, snapToWrapHead } from "./mirrorAnchor";
export type { MirrorAnchor } from "./mirrorAnchor";

// First-frame-is-snapshot vs. live-delta discrimination for a reattaching stream
// — runtime-neutral (constructs nothing), so it stays on the daemon-safe root.
export { createSnapshotBoundary } from "./snapshotBoundary";
export type { SnapshotBoundary } from "./snapshotBoundary";
