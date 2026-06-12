/** `@kolu/surface-daemon-supervisor` — the **supervisor half** of the
 *  surface-daemon spine (Atlas: `surface-daemon`). The mechanism a process uses
 *  to spawn, watch, and recycle a surface daemon it does NOT run in — the mirror
 *  of `@kolu/surface-daemon` (the daemon half).
 *
 *  This package runs in the *client* process (kolu-server today; the odu CLI /
 *  odu-web next), never in the daemon. It is therefore deliberately NOT a
 *  staleKey hash root — a change here cannot change what a daemon restart would
 *  load. It carries zero `kolu-*` workspace deps (pinned by
 *  `deps.closure.test.ts`) so the second tenant (`odu serve`, S2) reuses it
 *  without dragging kolu in, and it composes the gate's file-format primitives
 *  (`gatePid`/`isHolderLive`) from `@kolu/surface-daemon` over a one-directional
 *  edge.
 *
 *  What's spine here (program-agnostic): the endpoint state machine, the
 *  `waitForPidGone` reap-wait, the composed `restart` sequence, and the
 *  survivable-spawn driver (host-platform volatility). What stays the caller's
 *  soul: the daemon binary + its values (`localDriver.ts` in kolu-server), the
 *  contract handshake, and what `identity` means — all arrive as parameters.
 */

export {
  type DaemonConnection,
  type Endpoint,
  type EndpointSpec,
  type EndpointState,
  type EndpointStatus,
  ENDPOINT_STATES,
  createEndpoint,
} from "./endpoint.ts";
export { dialSocket } from "./dialSocket.ts";
export {
  type DaemonDriver,
  type DaemonSpawnConfig,
  type SpawnDriverDeps,
  survivableSpawnDriver,
} from "./driver.ts";
export { type RestartSteps, restart } from "./restart.ts";
export {
  type WaitForPidGoneOptions,
  waitForPidGone,
} from "./waitForPidGone.ts";
