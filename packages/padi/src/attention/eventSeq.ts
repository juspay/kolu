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
