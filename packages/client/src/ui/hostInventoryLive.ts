/**
 * Is the bound host's `hostInventory` reading a TRUSTWORTHY live scan the dialog may
 * present as a definite answer — or should it read "unavailable"?
 *
 * TWO independent ways a reading is not trustworthy, and BOTH must be excluded (#1034 —
 * never show a stale/empty list as a definite live scan):
 *
 *   1. **Not connected.** If the bound padi isn't live (an ssh link that dropped, a
 *      `daemon.restart` drain window, or a bind that never connected), the re-served cell
 *      is either the seeded empty default OR the LAST value held STALE across the drop —
 *      `reServeSurface` holds `value` cells across a disconnect, it does not reset them.
 *      Payload content alone CANNOT tell a fresh reading from a stale held one, so this
 *      leg reads the canonical bind-liveness FACT (`bindLive`), not the payload. kolu's
 *      honest bind signal is `daemonChannelLive` (the browser transport ∧ the active
 *      entry's own connection, uniform for local and remote — W4 daemon-rail unification)
 *      — NOT the re-served surface's own health, which is itself held stale (see
 *      `useDaemonStatus`).
 *   2. **Connected but no frame yet.** A just-connected bind whose sampler hasn't
 *      delivered its first frame leaves the seeded empty `{ kavals: [], padis: [] }`. A
 *      live padi ALWAYS reports ITSELF (`withSelfPadi` seeds the serving padi's active
 *      row even on the T+0 tick / under `--socket`), so "no active padi row" is the tell
 *      that no real frame has landed — distinct from a genuine zero (which can't happen:
 *      the serving padi is always there).
 *
 * A reading is live iff BOTH hold: the bind is live AND the serving padi is present. So a
 * dropped link (stale held reading) reads "unavailable" by the bind-liveness leg, and a
 * pre-first-frame connected bind reads "unavailable" by the self-padi leg — the "shown as
 * a definite live scan" state is unspellable without a real frame over a live bind.
 */

import type { RunningPadi } from "kolu-common/surface";

/** The composite liveness predicate — pure, so it is unit-testable without the wire
 *  singletons the accessor wires it to. `bindLive` is the canonical bind-liveness fact
 *  (browser transport ∧ the active entry's own connection); `padis` is the bound host's
 *  padi rows. A reading is live iff the bind is live AND the serving padi reported
 *  itself. */
export function hostInventoryLive(opts: {
  bindLive: boolean;
  padis: readonly RunningPadi[];
}): boolean {
  return opts.bindLive && opts.padis.some((p) => p.active);
}
