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
  // A session-preserving restart in flight (B3.2): the supervisor reports this
  // across the whole capture → drain → recycle → reattach sequence instead of
  // the bare recycle's connecting→connected flicker, so an observer (kolu's
  // KAVAL rail, the DegradedCanvas) shows one honest "restarting" while the old
  // daemon is torn down and a fresh one is brought up. Transient, not a down
  // state — it resolves to `connected` (success) or `dead` (failed recycle).
  "restarting",
  "degraded",
  "dead",
  // A PROVEN contract skew (SK4): the daemon that is (or would be) at this
  // endpoint speaks a contract this supervisor's build cannot talk to, and a
  // respawn from the currently-realised closure has already been tried (or is
  // pointless by construction — the refuse arm). Terminal like `dead`, but a
  // DIFFERENT verdict: restarting cannot fix it, only changing the closure
  // can — so a UI deriving affordances from this sum never offers a restart
  // against it. Carries both contract versions on the status arm.
  "incompatible",
] as const;

export type EndpointState = (typeof ENDPOINT_STATES)[number];

/** The TOTAL down/terminal classification of the endpoint states — "does this
 *  state end a dial / count the daemon as down?" — declared at the states' HOME
 *  so it moves with the tuple. A `Record` over `EndpointState` (not a bare
 *  down-list): adding a member to {@link ENDPOINT_STATES} is a compile error
 *  HERE until the new state is classified, so no consumer ever has to remember
 *  the classification by hand — a hand-spelled `degraded || dead || …` disjunct
 *  that misses a terminal state silently strands a dial's `closed` and stalls
 *  reconciliation (the exact class the `incompatible` arm nearly hit). */
export const ENDPOINT_STATE_DOWN: Record<EndpointState, boolean> = {
  connecting: false,
  connected: false,
  restarting: false,
  degraded: true,
  dead: true,
  incompatible: true,
};

/** True iff `s` is a down/terminal endpoint state, per the home classification
 *  {@link ENDPOINT_STATE_DOWN}. Consumers (a dial-ended check, a client
 *  presentation table's `down` flags) read THIS instead of re-spelling the
 *  disjunct. */
export function isDownEndpointState(s: EndpointState): boolean {
  return ENDPOINT_STATE_DOWN[s];
}
