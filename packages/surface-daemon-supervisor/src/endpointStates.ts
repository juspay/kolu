/**
 * The set of daemon states the endpoint reports — the single source of truth.
 *
 * This leaf deliberately imports NOTHING (no `node:*`, no transport, no gate) so
 * it is **browser-safe**: a browser-shared consumer (kolu's `DaemonStatusSchema`
 * in `kolu-common/surface`) can derive its state enum from this tuple — via the
 * dedicated `@kolu/surface-daemon-supervisor/states` subpath — without dragging
 * the supervisor's Node-only graph (`dialSocket`'s `node:net`, the driver's
 * `node:child_process`, the gate's pid helpers) into the client bundle. The
 * endpoint and the package root both re-export it, so the supervisor still owns
 * the tuple; only its *physical* location moved to a zero-dependency file.
 */

export const ENDPOINT_STATES = [
  "connecting",
  "connected",
  // A supervised restart is in flight (capture → drain → recycle → reattach). A
  // transient, non-terminal state the endpoint holds between an existing
  // connection and the fresh one, so the UI shows "recycling" rather than either
  // a stale "connected" or a false "dead"/"degraded". Concurrent restart triggers
  // coalesce onto the one in flight (they observe `restarting`).
  "restarting",
  "degraded",
  "dead",
] as const;

export type EndpointState = (typeof ENDPOINT_STATES)[number];
