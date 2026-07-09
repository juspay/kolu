import type { ConnectionInfo } from "kolu-common/surfacesWithPadi";

/** Floor the ACTIVE host's per-entry `connection` cell on the map's transport liveness — the
 *  client-side twin of surface-map's `floorOnLiveness` for `EntryStatus`.
 *
 *  `EntryStatus` (the chip) already demotes a stale `connected` to `warming` when OUR link to
 *  the publisher is dead/half-open (surface-map `floorOnLiveness`, #1568). The per-entry
 *  `connection` cell (the connect overlay's narration) had NO such floor: a cell frozen at
 *  `building`/`copying` — e.g. its per-entry forward-stream ended on a membership flap while
 *  the always-on `entries` collection recovered — kept asserting a definite provisioning phase
 *  forever, un-refreshable, so the overlay narrated a build that was no longer live. With OUR
 *  link to the publisher not live, the last-received phase cannot be trusted; drop it (assert
 *  no phase) so the resolver falls back to a neutral surface, exactly as the chip demotes.
 *
 *  A live link passes the value through untouched (a genuine remote build is narrated THROUGH a
 *  live ws to kolu-server, so `live` is `true` and this is a no-op then). Pure so the floor is
 *  unit-pinnable without a half-openable transport. */
export function floorConnectionInfo(
  info: ConnectionInfo | undefined,
  live: boolean,
): ConnectionInfo | undefined {
  return live ? info : undefined;
}
