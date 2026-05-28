/**
 * `@kolu/pty-host` — long-lived multi-client PTY-owner primitive.
 *
 * One process holds the node-pty children, the @xterm/headless mirrors,
 * and the per-PTY subscriber bookkeeping. Consumers (the kolu agent
 * locally, the kolu remote agent over ssh) call `createPtyHost(opts)`
 * and get a typed handle whose `attach(id)` yields a snapshot of the
 * current screen state plus an async-iterable of live deltas — the
 * snapshot-then-delta semantics that make late-joining and reattach
 * cheap.
 *
 * Sibling primitive to `@kolu/solid-xterm` in shape: a node-side
 * encapsulation of xterm-internals (`node-pty` + `@xterm/headless` +
 * the `createRequire` shim + multi-subscriber fan-out) behind one
 * stable surface. Does NOT depend on `@kolu/surface`; the agent
 * composes both.
 */

export {
  createPtyHost,
  getScreenText,
  type PtyEvent,
  type PtyHost,
  type PtyHostOptions,
  type PtyId,
  type PtyListEntry,
  type PtySpawnOpts,
} from "./ptyHost.ts";
