/** `@kolu/surface-daemon` — the **daemon half** of the surface-daemon spine
 *  (Atlas: `surface-daemon`). The recurring shape of a long-lived process that
 *  owns a unix socket, serves a typed `@kolu/surface`, and is supervised from
 *  outside — decomposed into the mechanism that is identical across daemons
 *  (kaval today, `odu serve` next).
 *
 *  This package holds ONLY code that runs inside the daemon process:
 *   - `acquirePidGate` / `readPidGate` — the atomic single-instance gate, both
 *     sides of one file format (acquire runs in the daemon; read runs in the
 *     supervisor, from B2).
 *   - `daemonMain` — the gate → serve → teardown skeleton, parameterized over
 *     the scope key, socket path, surface router, and lifetime policy.
 *
 *  The **supervisor half** (endpoint state machine, spawn/`waitForPidGone`
 *  drivers, composed restart) deliberately does NOT live here yet — it is built
 *  server-side in kaval B2 and moves in at S1. The invariant that keeps this
 *  package's whole-directory hash a correct staleKey contribution: **only code
 *  that runs in the daemon lives here.**
 */

export {
  daemonMain,
  type DaemonExit,
  type DaemonLifetime,
  type DaemonSpec,
} from "./daemonMain.ts";
export type { Logger } from "./logger.ts";
export {
  acquirePidGate,
  type GateAcquisition,
  readPidGate,
} from "./pidGate.ts";
