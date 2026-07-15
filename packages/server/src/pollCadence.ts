/**
 * `captureLatest` — kolu-server's synchronous liveness snapshot for a reactor poll
 * read (the memory cell's `readPadiMemoryOnce` gate).
 *
 * (SR8.c: the interval+edge cadence fuse this file also carried — `everyMsOrOnState`
 * — GRADUATED into `@kolu/surface`'s reactor as the domain-free `everyMsOr(ms,
 * subscribe)`, deleting the once-duplicated app-local twins. `captureLatest` stays at
 * app policy DELIBERATELY: one consumer, and its deeper cure — surface-remote's honest
 * liveness during `connecting` — is a separately-recorded follow-up, not a framework
 * primitive.)
 */

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
 *  later change; the initial `read()` seeds regardless. Returns the snapshot getter. The
 *  subscription is process-lifetime (the caller reads the snapshot forever), so its
 *  unsubscribe is intentionally not surfaced — returning a teardown nobody calls would be
 *  a dead knob, and discarding it matches every other process-lifetime `onState`
 *  subscription in the boot. */
export function captureLatest<T>(
  subscribe: (onChange: () => void) => () => void,
  read: () => T,
): () => T {
  let latest = read();
  subscribe(() => {
    latest = read();
  });
  return () => latest;
}
