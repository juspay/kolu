/** `@kolu/pty-host` — the PTY-owner primitive, its wire contract, and the
 *  in-process serving of that contract.
 *
 *  - `createPtyHost` — the **primitive**: a `node-pty` child + an
 *    `@xterm/headless` screen mirror + the VT-derived event taps (cwd via
 *    OSC 7, title via OSC 0/2, command-run via OSC 633, foreground via
 *    `tcgetpgrp`, exit), fanned out through a bounded per-PTY channel. Owns
 *    ONLY the PTY — no git, PRs, agents, file tree, or transport. It takes a
 *    fully-prepared spawn (env/shell-init is the caller's job — `kolu-pty`).
 *  - `ptyHostSurface` — the typed **contract** (the `PtyHost` interface
 *    projected onto a wire) + its version + compatibility check.
 *  - `createInProcessPtyHostClient` — the contract's in-process **serving** (the
 *    identity link): it prepares the shell env and serves `ptyHostSurface`
 *    over `createPtyHost` with no transport, handing back a contract-typed
 *    client. The same body is served over a socket by the surviving daemon
 *    later; the consumer (kolu-server) is invariant under that swap.
 */

export {
  createPtyHost,
  type ForegroundSample,
  type PtyAttachment,
  type PtyHandle,
  type PtyHost,
  type PtyHostOptions,
  type PtyId,
  type PtyListEntry,
  type PtySpawnOpts,
  type PtySpawnResult,
} from "./ptyHost.ts";

// The pty-host wire contract — the surface, its version, and the
// compatibility check. `ptyHostSurface` is a VALUE export (not type-only):
// consumers do `typeof ptyHostSurface.contract` to type their client, which
// collapses to `unknown` under a type-only re-export.
export {
  isPtyHostContractCompatible,
  PTY_HOST_CONTRACT_VERSION,
  ptyHostSurface,
  type PtyHostDataMsg,
  type PtyHostForegroundMsg,
  type PtyHostListEntry,
  type PtyHostSurface,
  type PtyHostSystemVersion,
} from "./ptyHostSurface.ts";

// The contract's in-process serving (the identity link) + the contract-typed
// client the consumer holds. The serving body is reused over a socket by the
// surviving daemon later — only the link is swapped.
export {
  createInProcessPtyHostClient,
  type InProcessPtyHostDeps,
  type PtyHostClient,
} from "./inProcessPtyHost.ts";
