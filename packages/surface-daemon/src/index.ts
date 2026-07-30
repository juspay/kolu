/** `@kolu/surface-daemon` — the **durable-daemon spine** (Atlas: `surface-daemon`).
 *  The recurring shape of a long-lived process that owns a unix socket, serves a
 *  typed `@kolu/surface`, and outlives the clients that dial it — decomposed
 *  into the mechanism that is identical across daemons (kaval today, `odu serve`
 *  next). It holds the **two halves of the daemon *binary***:
 *
 *   - **Serve it** — code that runs *inside* the daemon process:
 *     - `claimPidGate` / `acquirePidGate` — the single-instance gate. The
 *       named claim composes atomic `link(2)` with the one-field socket
 *       confirm; the gate's file format is single-sourced here under the
 *       **pid-first tolerant-reader law** (`gatePid` / `gateIdentity` /
 *       `readGateIdentity`); process identity is injected via
 *       `ReadProcessIdentity` so OS traversal never crosses into this
 *       daemon-hashed package.
 *     - `daemonHome` — where the daemon's files live (durable state dir vs
 *       session-scoped runtime dir), created `0700` with gate beside socket
 *       and `SharedArtifact` registry entries by construction.
 *     - `daemonMain` — the gate → serve → teardown skeleton, parameterized over
 *       the scope key, socket path, surface router, and lifetime policy.
 *     - `daemonProcessMain` — the bin half of that partition: run the daemon
 *       to completion and OWN the process exit (code + swallow-proof crash
 *       arm), so a live resource or timer can't linger a finished daemon.
 *   - **Front it** — code that runs in a per-link *proxy* process reaching the
 *     daemon over ssh-stdio (P2.5):
 *     - `frontDaemonOverStdio` — the **durable counterpart to `serveOverStdio`**:
 *       adopt-or-spawn the gate-held daemon and raw-byte-relay a stdio link to
 *       its socket, so a remote session survives the link. `dtach`/`abduco` for
 *       any surface daemon.
 *     - `reExecAsDetachedDaemon` — the same-binary spawn strategy kaval supplies
 *       as its `spawnDaemon` (the front has no built-in default — `spawnDaemon`
 *       is a required option; re-exec minus the front flag, as the
 *       signal-deliverable single-process `node --import` form).
 *
 *  Both halves are part of the *same executable* (kaval `serve`s; `kaval --stdio`
 *  fronts — one binary, flag-dispatched), so both legitimately sit inside the
 *  consumer's daemon-binary closure that nix hashes whole into its staleKey (the
 *  front is reached from `bin.ts`'s `--stdio` dispatch, exactly as kaval's own
 *  bridge was before P2.5). The **supervisor half** (endpoint state machine,
 *  spawn/`waitForPidGone` drivers, composed restart) deliberately NEVER lives
 *  here — it runs in the *client*, never the daemon, and is born as its own
 *  `@kolu/surface-daemon-supervisor` package. The standing invariant that keeps
 *  this package's whole-directory hash a correct staleKey contribution: **only
 *  code in the daemon binary (serve + front) lives here — never the supervisor.**
 */

export {
  type DaemonBuildIdentity,
  readBakedIdentity,
} from "./buildIdentity.ts";
export {
  CONTROL_CORE_VERSION,
  type ControlCoreFragment,
  type ControlCoreHello,
  ControlCoreHelloSchema,
  controlCoreFragment,
  controlCoreProcedureSpec,
  controlCoreSurface,
} from "./controlCore.ts";
export {
  buildLabel,
  buildsMatch,
  contractIsCompatible,
  contractIsNewer,
  type ConvergenceIdentity,
  type DaemonBuild,
  daemonBuild,
} from "./convergenceIdentity.ts";
export {
  daemonHome,
  resolveDaemonHome,
  type DaemonHome,
  type DaemonHomeOptions,
  type DaemonHomePaths,
  type DaemonHomePlacement,
  type DaemonHomeRuntimeRoot,
  type ResolveDaemonHomeOptions,
  type ResolvedDaemonHome,
} from "./daemonHome.ts";
export { isPrivateOwnedDir } from "./privateOwnedDir.ts";
export {
  anchorGone,
  DAEMON_BIND_PID_ENV,
  type DaemonExit,
  type DaemonLifetime,
  type DaemonLifetimeInfo,
  type DaemonShutdownReason,
  type DaemonSpec,
  daemonLifetimeFromEnv,
  daemonMain,
  lifetimeInfo,
} from "./daemonMain.ts";
export {
  type FrontDaemonOverStdioOptions,
  frontDaemonOverStdio,
  type ReExecAsDetachedDaemonOptions,
  reExecAsDetachedDaemon,
} from "./frontDaemonOverStdio.ts";
export { type Logger, stderrLogger } from "./logger.ts";
export {
  acquirePidGate,
  claimPidGate,
  confirmHeldGate,
  type GateAcquisition,
  type GateIdentityRead,
  gateIdentity,
  gatePid,
  identitiesMatch,
  isHolderLive,
  liveHolderFromRecord,
  liveHolderPid,
  type ProcessIdentity,
  type ReadProcessIdentity,
  readGateIdentity,
  SOCKET_SERVE_PROBE_MS,
  type SocketServeState,
  START_TIME_TOLERANCE_US,
  startTimesMatch,
  socketServeState,
} from "./pidGate.ts";
export type { SharedArtifact } from "./sharedArtifact.ts";
export { daemonProcessMain } from "./tenure.ts";
