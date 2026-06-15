/** `@kolu/surface-daemon` — the **durable-daemon spine** (Atlas: `surface-daemon`).
 *  The recurring shape of a long-lived process that owns a unix socket, serves a
 *  typed `@kolu/surface`, and outlives the clients that dial it — decomposed
 *  into the mechanism that is identical across daemons (kaval today, `odu serve`
 *  next). It holds the **two halves of the daemon *binary***:
 *
 *   - **Serve it** — code that runs *inside* the daemon process:
 *     - `acquirePidGate` — the atomic single-instance gate. The gate's file
 *       format is single-sourced here as two daemon-running primitives
 *       (`gatePid`, the pid parse; `isHolderLive`, the liveness probe) that the
 *       supervisor (kolu-server, from B2) composes where it lives — so the
 *       reader itself never crosses into this daemon-hashed package.
 *     - `daemonMain` — the gate → serve → teardown skeleton, parameterized over
 *       the scope key, socket path, surface router, and lifetime policy.
 *   - **Front it** — code that runs in a per-link *proxy* process reaching the
 *     daemon over ssh-stdio (P2.5):
 *     - `frontDaemonOverStdio` — the **durable counterpart to `serveOverStdio`**:
 *       adopt-or-spawn the gate-held daemon and raw-byte-relay a stdio link to
 *       its socket, so a remote session survives the link. `dtach`/`abduco` for
 *       any surface daemon.
 *     - `reExecAsDetachedDaemon` — the same-binary spawn strategy the front
 *       defaults to (re-exec minus the front flag, as the signal-deliverable
 *       single-process `node --import` form).
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
  type DaemonExit,
  daemonExitCode,
  type DaemonLifetime,
  daemonMain,
  type DaemonSpec,
} from "./daemonMain.ts";
export {
  type FrontDaemonOverStdioOptions,
  frontDaemonOverStdio,
  type ReExecAsDetachedDaemonOptions,
  reExecAsDetachedDaemon,
} from "./frontDaemonOverStdio.ts";
export type { Logger } from "./logger.ts";
export {
  acquirePidGate,
  type GateAcquisition,
  gatePid,
  isHolderLive,
} from "./pidGate.ts";
