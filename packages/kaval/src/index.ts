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
 *    `tcgetpgrp`, exit), fanned out through a bounded per-PTY fan-out. Owns
 *    ONLY the PTY — no git, PRs, agents, file tree, or transport. It takes a
 *    fully-prepared spawn (env/shell-init is the caller's job — `kolu-pty`).
 *  - `ptyHostSurface` — the typed **contract** (the `PtyHost` interface
 *    projected onto a wire) + its version + compatibility check.
 *  - `servePtyHost` — the contract's **serving**, transport-agnostic: serves
 *    `ptyHostSurface` over `createPtyHost`, returning `{ group, handlers }`
 *    (+ ctx). It
 *    derives no env or shell-init policy (B0, the kaval inversion) — it only
 *    materialises the `initFiles` it is handed under the injected `rcDir` and
 *    spawns the supplied `argv`/`env` verbatim. Reused over a socket by the
 *    daemon and over ssh by R-2 — only the link differs.
 *  - `createInProcessPtyHost` — the **identity link**: builds the host once and
 *    returns the no-wire `directDispatch` client over it (plus `{ group, handlers }` for the
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
// `createInProcessPtyHost` closes the loop with the no-wire `directDispatch`,
// handing the consumer its spec-typed client (and `{ group, handlers }` for the
// socket transport). A later phase swaps only the dispatch.
export {
  createInProcessPtyHost,
  type InProcessPtyHostDeps,
  type PtyHostBoot,
  type PtyHostServed,
  servePtyHost,
} from "./inProcessPtyHost.ts";
// The one typed face, and the one way to build it over any dispatch — a wire
// link's or the in-process direct one. VALUE export for `ptyHostClientOver`.
export {
  type PtyHostClient,
  ptyHostClientOver,
} from "./ptyHostClient.ts";
// The per-subscriber drop the PTY taps carry on their error channel — named in
// `PtyAttachment.deltas`, so a consumer that narrows on it can spell the type.
// `FanOut` itself is a VALUE export: it is the primitive that owns "is this
// subscription still attached?", and `subscriberCount` is the only honest
// observable of a LEAKED attach subscription. padi's re-open loop is the code
// that can leak one (kolu#2101 K2), so its proof runs against the real fan-out
// rather than a re-implementation of it — which needs the class nameable there.
export { FanOut, type SubscriberOverflow } from "./fanOut.ts";
export {
  type CommandRunSubscription,
  createPtyHost,
  // VALUE export (the per-terminal mirror-depth constant): a type-only re-export
  // would collapse it to nothing at runtime. The server imports this as the
  // scrollback it sends, so the same number governs every spawn path.
  DEFAULT_MIRROR_SCROLLBACK,
  type ForegroundSample,
  type ForegroundSubscription,
  type InventorySubscription,
  type PtyAttachment,
  type PtyHandle,
  type PtyHistoryChunk,
  type PtyHost,
  type PtyHostOptions,
  type PtyId,
  type PtyListEntry,
  type PtySpawnOpts,
  type PtySpawnResult,
  type RetainedCommand,
  // The bounded attach-snapshot depth — paired with DEFAULT_MIRROR_SCROLLBACK in
  // the scrollback-backfill sizing invariant a consumer asserts at startup.
  SNAPSHOT_SCROLLBACK,
  // The public bound type named in `PtyHost`/`PtyHandle`'s `getScreenText`
  // signatures — re-exported so a downstream consumer can name the parameter.
  type ScreenExtent,
} from "./ptyHost.ts";
// The pty-host wire contract — the surface and its version. `ptyHostSurface` is
// a VALUE export (not type-only): consumers pass `ptyHostSurface.group` to a link
// factory and `typeof ptyHostSurface.spec` to the client type, and both collapse
// under a type-only re-export.
// Compatibility check: `isContractVersionCompatible` from `@kolu/surface/define`.
export {
  DEFAULT_SPAWN_SHELL,
  PTY_HOST_CONTRACT_VERSION,
  // The one attributed-cell row ceiling. Exported because padi DERIVES its own
  // `SCREEN_IMAGE_MAX_ROWS` from it rather than spelling a second 200 that
  // could drift out of step with the schema that enforces it.
  SCREEN_CELLS_MAX_ROWS,
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
  // The DECLARED error vocabulary (D4) — VALUE exports: a consumer narrows on
  // `_tag`, and a producer of a fake host constructs them.
  PtyNotFound,
  SpawnArgvEmpty,
} from "./ptyHostSurface.ts";

// Serve the pty-host wire over a unix socket — the socket link this package
// promises. kolu-server uses it for kaval-tui (R-4 Phase 1); Phase B's daemon
// reuses it unchanged.
export {
  type PtyHostSocketListener,
  servePtyHostOverUnixSocket,
} from "./serveOverSocket.ts";
// The standalone daemon's additive wire: historic flat pty-host tags plus the
// frozen control-core sibling, as ONE group. `kavalControlSurface` is what a
// supervisor builds its control face from (its tags already carry the
// `surface/control/` prefix); ordinary pty-host consumers keep using
// `ptyHostSurface` unchanged.
export {
  kavalControlSurface,
  kavalDaemonGroup,
  type KavalDaemonSurface,
  serveKavalDaemonSurface,
} from "./daemonSurface.ts";
// The well-known unix-socket path the pty-host is served on (kolu-server) and
// connected to (kaval-tui) — one resolver both packages share so the default
// path can never drift between them.
export {
  type KavalCandidateKind,
  type KavalDaemon,
  discoverKavalCandidates,
  discoverKavalDaemons,
  discoverPtyHostSockets,
  getPtyHostSocketPath,
  isPrivateOwnedDir,
  isSocketInode,
  KAVAL_GATE_FILE,
  KAVAL_LOG_FILE,
  KAVAL_NS_PREFIX,
  type KavalSocketCandidate,
  type KavalSocketResolution,
  kavalLogPath,
  legacyKavalSocketPath,
  PTY_HOST_SOCK_FILE,
  readStateRootManifest,
  resolveRunningKavalSocket,
  STATE_ROOT_MANIFEST_FILE,
  writeStateRootManifest,
} from "./socketPath.ts";
// The production-safe runtime spawn leash (juspay/kolu#1334 A8, F5) the REAL kolu
// daemon-spawn funnels (localKavalDriver / localPadiDriver) wrap their spawn with.
export { assertDaemonSpawnAllowed } from "./daemonSpawnGate.ts";
// kaval's own convergence DECLARATION — who kaval is and what a supervisor
// should do about a resident that isn't. It moved here from padi's ptyHost when
// kaval grew a SECOND supervisor (`kaval --stdio` converges before it relays,
// juspay/kolu#2101): a policy two supervisors must agree on cannot live inside
// one of them.
export { kavalConvergencePolicy } from "./convergencePolicy.ts";
