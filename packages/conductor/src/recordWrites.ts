/**
 * HOW OFTEN KOLU'S STATE HITS DISK, AND WHAT JUMPS THE QUEUE — one leading-edge
 * timer over however many records the host owes.
 *
 * The records move at wildly different rates: the transcript at an agent's
 * output cadence, the works when something is observed, a member when its
 * terminal is read, the conversation's own record when the session or the
 * model changes. ONE timer and one flag per record, so a streaming answer
 * rewrites the transcript file and nothing else — which is the whole reason
 * the rows left `config.json`.
 *
 * Leading-edge: the first movement is durable immediately, and a burst then
 * costs one write per window instead of six hundred. {@link RecordWrites.now}
 * is the bypass, for the movements whose whole point is that what was there is
 * gone (a work ending, a restore, the wipe) — a window in which the file still
 * holds the old value is a window in which the next boot undoes them.
 */

/** The write cadence, over a fixed set of record names. */
export interface RecordWrites<K extends string> {
  /** Something moved; the file should say so within the window. */
  readonly schedule: (what: K) => void;
  /** Write one record NOW, whatever the throttle thinks. */
  readonly now: (what: K) => void;
  /** Write whatever is still owed, now. The one caller is the host's
   *  `dispose` — a server that stopped mid-window would otherwise lose the
   *  tail of the conversation it just finished having. */
  readonly flush: () => void;
}

export const recordWrites = <K extends string>(
  write: Readonly<Record<K, () => void>>,
  throttleMs: number,
): RecordWrites<K> => {
  const names = Object.keys(write) as unknown as ReadonlyArray<K>;
  const due = new Set<K>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wroteAt = 0;

  const writeDue = (): void => {
    wroteAt = Date.now();
    // Taken before the writes run: a write that schedules another record (the
    // one below it in this loop) must not be dropped by the clear.
    const owed = [...due];
    due.clear();
    for (const what of names) if (owed.includes(what)) write[what]();
  };

  return {
    schedule: (what) => {
      due.add(what);
      if (timer !== undefined) return;
      const since = Date.now() - wroteAt;
      if (since >= throttleMs) {
        writeDue();
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        if (due.size > 0) writeDue();
      }, throttleMs - since);
      // A pending write must never be the reason this process stays up: the
      // records are a convenience for the NEXT kolu-server, and the flush
      // above is what a teardown owes them.
      timer.unref();
    },
    now: (what) => {
      due.add(what);
      writeDue();
    },
    flush: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (due.size > 0) writeDue();
    },
  };
};
