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
 *  - `servePtyHost` — the contract's **serving**, transport-agnostic: prepares
 *    the shell env and serves `ptyHostSurface` over `createPtyHost`, returning
 *    the router (+ ctx). Reused over a socket by the surviving daemon and over
 *    ssh by R-2 — only the link differs.
 *  - `createInProcessPtyHostClient` — the **identity link**: `directLink` over
 *    `servePtyHost`'s router with no transport, handing back a contract-typed
 *    client. The consumer (kolu-server) is invariant under a later link swap.
 */

// The running build identity — `currentBuildId()` (the staleKey, a hash of
// this package's source closure) and `currentCommitHash()` (the navigable git
// ref), both read from nix-baked env. VALUE exports: a type-only re-export
// would collapse them to nothing at runtime.
export { currentBuildId, currentCommitHash } from "./buildId.ts";
// The contract's serving: `servePtyHost` is the transport-agnostic half
// (reused over a socket by the surviving daemon and over ssh by R-2);
// `createInProcessPtyHostClient` closes the loop with the no-wire `directLink`,
// handing the consumer its contract-typed client. A later phase swaps only the
// link.
export {
  createInProcessPtyHost,
  createInProcessPtyHostClient,
  type InProcessPtyHostDeps,
  type PtyHostClient,
  type PtyHostRouter,
  servePtyHost,
} from "./inProcessPtyHost.ts";
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
  type PtyHostDataMsg,
  type PtyHostForegroundMsg,
  type PtyHostIdentity,
  PtyHostIdentitySchema,
  type PtyHostListEntry,
  type PtyHostSurface,
  type PtyHostSystemVersion,
  ptyHostSurface,
} from "./ptyHostSurface.ts";

// Serve the pty-host router over a unix socket — the socket link this package
// promises. kolu-server uses it for kolu-tui (R-4 Phase 1); Phase B's daemon
// reuses it unchanged.
export {
  type PtyHostSocketListener,
  servePtyHostOverUnixSocket,
} from "./serveOverSocket.ts";
// The well-known unix-socket path the pty-host is served on (kolu-server) and
// connected to (kolu-tui) — one resolver both packages share so the default
// path can never drift between them.
export { getPtyHostSocketPath } from "./socketPath.ts";
