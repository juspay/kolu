/**
 * The daemon's ONE watch-event sequence — the number a standing subscription
 * acknowledges against.
 *
 * Two sources mint events into the same queues: the settle detector
 * (`settleEvents.ts` — "this terminal just started needing someone") and the
 * agent-state watch (`stateWatch.ts` — "this terminal has held `waiting` for a
 * minute"). A subscription is fed by exactly one of them, but the REGISTRY is
 * not: `open` seeds a fresh subscription's watermark from the daemon's current
 * sequence, and `drain` sanity-checks an acknowledgement against it as a
 * ceiling. Two private counters would make both of those read one source's
 * numbers while the buffer carried the other's — a fresh subscription silently
 * replaying history, or an honest acknowledgement rejected as "from a previous
 * padi generation".
 *
 * So the counter is a daemon-lifetime fact, minted once and handed to both
 * sources. It restarts at 0 on every padi boot, which is exactly what the
 * drain's ceiling check exists to notice.
 */

/** A monotonic counter with a readable watermark. */
export interface EventSeq {
  /** Stamp the next event. Strictly increasing, starting at 1. */
  next(): number;
  /** The highest stamp issued so far — 0 before the first event. */
  last(): number;
}

export function createEventSeq(): EventSeq {
  let seq = 0;
  return {
    next: () => ++seq,
    last: () => seq,
  };
}
