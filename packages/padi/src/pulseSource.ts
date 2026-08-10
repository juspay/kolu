/**
 * `@kolu/padi/pulseSource` — THE pulse-then-requery stream shape, once.
 *
 * padi has three value-bearing pulse streams (`subscribeRepoChange`,
 * `subscribeFileChange`, `watchPulse`) and they are all the same cassette: wrap
 * the producer edge in `streamFromAbortableSource`, drive the framework's
 * `pollOnEvent` over a callback watcher, dedup on `seq`, and REPORT a read
 * failure rather than swallow it. Lifted out of `fsDeps.ts` (whose header
 * says, correctly, that it is fs/git plumbing) the day the standing-subscription
 * doorbell became the third member of the family — two implementations of one
 * shape is how their `onReadError` came to disagree about whether a read failure
 * is worth logging.
 *
 * Yields `{seq:0}` at subscribe (the snapshot frame), then a fresh incrementing
 * `seq` on every debounced change — the distinct value is what defeats the
 * stream's `isEqual` dedup so each change reaches the consumer. Because the
 * counter is minted INSIDE the per-subscription factory, a ring is always a fresh
 * frame for that subscriber: there is no shared counter to read, and therefore no
 * way for "the thing I am watching is gone" to be spelled with the same number as
 * "nothing has happened yet".
 */

import { pollOnEvent, streamFromAbortableSource } from "@kolu/surface/server";
import type { Stream } from "effect";
import type { Logger } from "pino";

/** A monotonic per-subscription pulse source over a callback watcher.
 *
 *  Each watcher uses the raw `source` arm — NOT the poll-shape
 *  `{read,install,isEqual}` arm — because the `seq` counter must be allocated PER
 *  SUBSCRIPTION: the framework calls a `source` thunk afresh per subscribe (so
 *  the closure-local `seq` is private to that subscription), whereas the
 *  poll-shape's `read`/`install` are one shared dep-object function whose closure
 *  would leak `seq` across concurrent subscribers. Inside the thunk we still
 *  reuse the framework's `pollOnEvent` (snapshot-then-deltas by construction) —
 *  no hand-rolled snapshot loop, no second watcher.
 *
 *  `pollOnEvent` is still the ONE snapshot-then-deltas poll implementation (S2
 *  kept it AbortSignal-shaped because it IS the producer edge); this wraps it at
 *  that edge with the framework's single sanctioned bridge, so interruption of
 *  the subscribing fiber aborts the underlying subscription exactly as the
 *  framework's own `signal` used to. */
export function pulseSource(
  install: (onEvent: () => void) => () => void,
  log: Logger,
  label: string,
): Stream.Stream<{ readonly seq: number }> {
  return streamFromAbortableSource<{ readonly seq: number }>((signal) => {
    let seq = 0;
    return pollOnEvent<{ readonly seq: number }>({
      read: () => Promise.resolve({ seq: seq++ }),
      isEqual: (a, b) => a.seq === b.seq,
      install,
      signal,
      onReadError: (err) =>
        log.error({ err }, `padi: ${label} pulse read failed`),
    });
  });
}
