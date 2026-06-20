/** `kaval` — the standalone PTY daemon: the PTY-owner primitive, its wire
 *  contract, the in-process serving of that contract, and (B1) the process
 *  entry that turns it into a runnable program.
 *
 *  This `index.ts` is the **library surface** kolu-server embeds in-process
 *  (the web path) and kaval-tui dials over a socket. The **daemon entry**
 *  (`bin.ts` → `daemonMain.ts` → `@kolu/surface-daemon`) is deliberately NOT
 *  re-exported here — it is the executable, reached by the closure test as its
 *  own root, not pulled into every consumer of the library.
 *
 *  - `createPtyHost` — the **primitive**: a `node-pty` child + an
 *    `@xterm/headless` screen mirror + the VT-derived event taps (cwd via
 *    OSC 7, title via OSC 0/2, command-run via OSC 633, foreground via
 *    `tcgetpgrp`, exit), fanned out through a bounded per-PTY channel. Owns
 *    ONLY the PTY — no git, PRs, agents, file tree, or transport. It takes a
 *    fully-prepared spawn (env/shell-init is the caller's job — `kolu-pty`).
 *  - `ptyHostSurface` — the typed **contract** (the `PtyHost` interface
 *    projected onto a wire) + its version + compatibility check.
 *  - `servePtyHost` — the contract's **serving**, transport-agnostic: serves
 *    `ptyHostSurface` over `createPtyHost`, returning the router (+ ctx). It
 *    derives no env or shell-init policy (B0, the kaval inversion) — it only
 *    materialises the `initFiles` it is handed under the injected `rcDir` and
 *    spawns the supplied `argv`/`env` verbatim. Reused over a socket by the
 *    daemon and over ssh by R-2 — only the link differs.
 *  - `createInProcessPtyHost` — the **identity link**: builds the host once and
 *    returns the no-wire `directLink` client over it (plus the router for the
 *    socket transport), so one host backs both the in-process (web) and socket
 *    (kaval-tui) paths. The consumer (kolu-server) is invariant under a later
 *    link swap.
 */

// The running build identity — `currentBuildId()` (the staleKey, a hash of
// this package's source closure) and `currentCommitHash()` (the navigable git
// ref), both read from nix-baked env. VALUE exports: a type-only re-export
// would collapse them to nothing at runtime.
export {
  currentBuildId,
  currentCommitHash,
  currentPtyHostIdentity,
} from "./buildId.ts";
// The contract's serving: `servePtyHost` is the transport-agnostic half
// (reused over a socket by the surviving daemon and over ssh by R-2);
// `createInProcessPtyHost` closes the loop with the no-wire `directLink`,
// handing the consumer its contract-typed client (and the router for the
// socket transport). A later phase swaps only the link.
export {
  createInProcessPtyHost,
  type InProcessPtyHostDeps,
  type PtyHostClient,
  type PtyHostRouter,
  servePtyHost,
} from "./inProcessPtyHost.ts";
export {
  createPtyHost,
  // VALUE export (the per-terminal mirror-depth constant): a type-only re-export
  // would collapse it to nothing at runtime. The server imports this as the
  // scrollback it sends, so the same number governs every spawn path.
  DEFAULT_MIRROR_SCROLLBACK,
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
// The pty-host wire contract — the surface and its version. `ptyHostSurface`
// is a VALUE export (not type-only): consumers do `typeof ptyHostSurface.contract`
// to type their client, which collapses to `unknown` under a type-only re-export.
// Compatibility check: `isContractVersionCompatible` from `@kolu/surface/define`.
export {
  DEFAULT_SPAWN_SHELL,
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostDataMsg,
  type PtyHostForegroundMsg,
  type PtyHostIdentity,
  PtyHostIdentitySchema,
  type PtyHostInitFile,
  type PtyHostInventoryEvent,
  type PtyHostListEntry,
  type PtyHostSpawnInput,
  type PtyHostSpawnResult,
  type PtyHostSurface,
  type PtyHostSystemInfo,
  type PtyHostSystemVersion,
  ptyHostSurface,
} from "./ptyHostSurface.ts";

// Serve the pty-host router over a unix socket — the socket link this package
// promises. kolu-server uses it for kaval-tui (R-4 Phase 1); Phase B's daemon
// reuses it unchanged.
export {
  type PtyHostSocketListener,
  servePtyHostOverUnixSocket,
} from "./serveOverSocket.ts";
// The well-known unix-socket path the pty-host is served on (kolu-server) and
// connected to (kaval-tui) — one resolver both packages share so the default
// path can never drift between them.
export {
  discoverPtyHostSockets,
  getPtyHostSocketPath,
  KAVAL_NS_PREFIX,
  type KavalSocketCandidate,
  type KavalSocketResolution,
  kavalNamespace,
  PTY_HOST_SOCK_FILE,
  resolveRunningKavalSocket,
} from "./socketPath.ts";
