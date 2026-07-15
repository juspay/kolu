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

/** Snapshot a value SYNCHRONOUSLY at each change-signal firing, for a reactor poll
 *  read to consult instead of a live accessor.
 *
 *  Why a snapshot: the reactor DEFERS each poll read by a microtask (`source`'s
 *  `tickRead` schedules `Promise.resolve().then(read)`), so a read that itself calls a
 *  LIVE accessor can observe state assigned AFTER the change that triggered it. The
 *  motivating case (kolu-server's `processMemory` cell): a bound-padi reconnect assigns
 *  `clientPromise = attempt()` in the SAME synchronous frame that `attempt()` fired
 *  `onState("connecting")` — so a deferred read calling `currentClient()` sees the
 *  just-assigned in-flight (or backoff-retained rejected) promise as truthy and reads a
 *  stale held mirror, where the retired SYNCHRONOUS sampler saw the pre-assignment
 *  `null` and reported `absent`. Capturing `read()` at the `subscribe` callback (which
 *  fires in that same synchronous frame) fixes the poll read's decision to the
 *  state-change instant.
 *
 *  `subscribe` is expected to fire its callback once on subscribe (seeding) and on each
 *  later change; the initial `read()` seeds regardless. Returns the current snapshot and
 *  the unsubscribe. */
export function captureLatest<T>(
  subscribe: (onChange: () => void) => () => void,
  read: () => T,
): { get: () => T; stop: () => void } {
  let latest = read();
  const stop = subscribe(() => {
    latest = read();
  });
  return { get: () => latest, stop };
}
