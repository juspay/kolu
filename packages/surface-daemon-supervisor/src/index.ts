/** `@kolu/surface-daemon-supervisor` — the **supervisor half** of the
 *  surface-daemon spine (Atlas: `surface-daemon`). The mechanism a process uses
 *  to spawn, watch, and recycle a surface daemon it does NOT run in — the mirror
 *  of `@kolu/surface-daemon` (the daemon half).
 *
 *  This package runs in the *client* process (kolu-server today; the odu CLI /
 *  odu-web next), never in the daemon. It is therefore deliberately NOT a
 *  staleKey hash root — a change here cannot change what a daemon restart would
 *  load. Its only workspace dependencies are the shared `@kolu/surface` transport
 *  and the `@kolu/surface-daemon` twin; `ts-pattern` provides exhaustive policy
 *  dispatch. That closure is pinned by `deps.closure.test.ts`, so the second
 *  tenant (`odu serve`, S2) reuses it without dragging an app package in.
 *  It composes the gate's file-format primitives (`readGateIdentity` /
 *  `identitiesMatch` / `isHolderLive`) from the daemon half over a
 *  one-directional edge; process identity is injected on `EndpointSpec`.
 *
 *  What's spine here (program-agnostic): the endpoint state machine, the
 *  `waitForPidGone` reap-wait, the composed `restart` sequence, and the
 *  survivable-spawn driver (host-platform volatility). What stays the caller's
 *  soul: the daemon binary + its values (`localDriver.ts` in kolu-server), the
 *  contract handshake, and what `identity` means — all arrive as parameters.
 */

export {
  type DaemonConnection,
  DaemonContractSkewError,
  type Endpoint,
  type EndpointSpec,
  type EndpointState,
  type EndpointStatus,
  type IncompatibleEndpointStatus,
  ENDPOINT_STATES,
  createEndpoint,
  isContractSkewError,
  isSocketSquatterForeignError,
  SocketSquatterForeignError,
} from "./endpoint.ts";
// EndpointSpec re-exported for consumers and for `./createEndpoint.testlib`
// (suites inject identity once via that helper).
export { type SocketHolder, socketHolders } from "./socketHolder.ts";
// The down/terminal classification lives at the states' home (the browser-safe
// `/states` leaf, like `ENDPOINT_STATES` itself) and is re-exported here for
// Node-side supervisor consumers.
export {
  ENDPOINT_STATE_DOWN,
  isDownEndpointState,
} from "./endpointStates.ts";
export { dialSocket } from "./dialSocket.ts";
export {
  type ControlCoreProbeClient,
  isNoListenerError,
  probeDaemonIdentity,
  probeDaemonIdentityFrom,
  readControlCoreHello,
  type ProbeDaemonIdentityFromOptions,
} from "./probeDaemonIdentity.ts";
export {
  type DaemonDriver,
  type DaemonSpawnConfig,
  scrubDaemonNodeOptions,
  type SpawnDriverDeps,
  survivableSpawnDriver,
} from "./driver.ts";
export {
  type RestartSteps,
  destructiveRecycleSteps,
  recycle,
  serializeRestart,
} from "./restart.ts";
export {
  type WaitForPidGoneOptions,
  waitForPidGone,
} from "./waitForPidGone.ts";
// The daemon-convergence kit — policy-as-the-parameter over the endpoint (Pins 1/2/3).
export * from "./convergence/index.ts";
