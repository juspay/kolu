/**
 * The fused cadence for kolu-server's DERIVED poll cells (`processMemory`,
 * `daemonInventory` — `derived.cell(source({ read, install }))` in `index.ts`).
 *
 * A poll cell's `install` owns the tick cadence the reactor drives. kolu-server's
 * host-independent readouts need TWO tick sources fused into one `install`:
 *   - a fixed coarse interval (the reactor's `unref`'d {@link everyMs}), and
 *   - the bound padi's connection-state changes (`padiSession.onState`) — so a padi
 *     drop/rebind FORCE-RESAMPLES at once instead of showing a frozen figure for up
 *     to a full interval (the ~5s stale-MB regression #1831 exists to prevent).
 *
 * This is the kolu-server twin of `@kolu/padi`'s local `everyMsOrOnDaemonChange`
 * (`servePadi.ts`) — same shape, a different change-signal (padi's own
 * `onDaemonStatusChange` there; the bound-session `onState` here, which only exists
 * after `index.ts`'s async boot — the very ordering SR8.a's serve-after-boot move
 * unblocks). The reactor owns the T+0 seed, the non-overlap/coalesce guard, and the
 * log-skip-continue; this only fuses the two tick sources.
 */

import { everyMs } from "@kolu/surface/reactor";

/** Fuse the reactor's `unref`'d `everyMs(ms)` interval with a `subscribe` change-
 *  signal (the bound padi's `padiSession.onState`) into one poll-cell `install`: the
 *  cell re-reads on the interval AND the instant the change-signal fires (a force-
 *  resample). `subscribe` returns its own unsubscribe; the composed cleanup clears
 *  BOTH the interval and the subscription. `subscribe`'s callback is the same `tick`
 *  the reactor hands `install`, so a force-resample rides the reactor's non-overlap
 *  guard exactly as an interval tick does. */
export function everyMsOrOnState(
  ms: number,
  subscribe: (tick: () => void) => () => void,
): (tick: () => void) => () => void {
  return (tick) => {
    const stopInterval = everyMs(ms)(tick);
    const off = subscribe(tick);
    return () => {
      off();
      stopInterval?.();
    };
  };
}
