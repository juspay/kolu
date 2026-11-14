/**
 * WHAT A WATCHED TERMINAL SAID THAT IS NOT AT THE AGENT YET — the held news,
 * in the order it first rang.
 *
 * PORTED FROM OLAI (`packages/plugins/chat/src/deliveries.ts`, and its test
 * `deliveries.test.ts`), simplified to the one thing kolu holds for: there is
 * exactly ONE conversation here, so the conversation key and its eviction cap
 * are gone, and the coalescing key is simply the terminal — one slot per
 * terminal, newest news only, kept where the first one landed. The rules that
 * survive the simplification are olai's and are worth having twice: replace IN
 * PLACE, hand back a COPY, and take BY IDENTITY.
 *
 * ## Why anything is held at all
 *
 * A turn is running and a watched terminal stops. Injecting that into the turn
 * would interrupt work nobody asked to interrupt; starting a second turn would
 * queue it behind the first and spend the conversation's interruption
 * (`@kolu/acp-harness`'s `queuedHere`). So it WAITS, and when the turn ends —
 * however it ended, a cancel included — everything waiting goes out as ONE
 * turn with one row.
 *
 * ## The three rules, and what each buys
 *
 * **Replace in place.** A terminal that stopped and then went away is ONE
 * subject with newer news, not two things to tell. The newest value lands in
 * the position the first one took, so a terminal that keeps changing does not
 * walk to the back of a queue it has been at the front of since the start.
 *
 * **`waiting()` hands back a copy.** The list behind it is mutated in place, so
 * a caller that kept the result across an await and handed it back would be
 * handing back whatever landed in between.
 *
 * **`took` takes BY IDENTITY.** A replace that landed while the wake was on the
 * wire wrote a NEW slot object into that position, and taking it by ref or by
 * index would drop news nobody ever saw.
 *
 * ## No cap
 *
 * olai bounds its lists because any number of plugins may ring any number of
 * times for any number of conversations. Here the list is one slot per WATCHED
 * terminal, and the watch list is the bound: a terminal can only be in here if
 * somebody put it on that list, and `withdraw` takes it off again the moment it
 * goes back to working. A cap would be a second bound on a bounded thing.
 */

/** One terminal's news, waiting. `ref` is the fleet ref (`host/id`), which is
 *  both the identity the slot is keyed by and the name the agent acts on. */
export interface HeldSlot<T> {
  readonly ref: string;
  readonly value: T;
}

export interface Held<T> {
  /** News about that terminal — appended, or REPLACING IN PLACE whatever it
   *  already had. */
  readonly hold: (ref: string, value: T) => void;
  /** Whether that terminal has anything waiting. Read by a caller putting back
   *  news whose delivery failed: newer news must win over the retry. */
  readonly has: (ref: string) => boolean;
  /** What is waiting, oldest first — the caller's to hand back to
   *  {@link Held.took} verbatim. */
  readonly waiting: () => ReadonlyArray<HeldSlot<T>>;
  /** ... and those ones landed, so they stop waiting. Slots that are no longer
   *  there — a replace that overtook the delivery — are silently not removed
   *  twice. */
  readonly took: (taken: ReadonlyArray<HeldSlot<T>>) => void;
  /** ... AND THAT TERMINAL WENT BACK TO WORKING, so what it was going to say
   *  stops waiting. The one verb here that throws news away, and it is owed:
   *  held news is a description of how something STOOD, and a terminal that is
   *  working again has stopped standing that way. Answers whether anything was
   *  actually withdrawn. */
  readonly withdraw: (ref: string) => boolean;
  /** Everything waiting, as refs in the order they first rang — the cell's
   *  `held`, which is what the status line counts. */
  readonly refs: () => ReadonlyArray<string>;
  /** Nothing is waiting any more — the conversation itself was wiped. */
  readonly clear: () => void;
}

export const holding = <T>(): Held<T> => {
  /** Insertion-ordered, and that order IS the order the news first rang: a
   *  replace writes over the value at a key the map already has, which keeps
   *  the position rather than moving it to the end. */
  const slots = new Map<string, HeldSlot<T>>();

  return {
    hold: (ref, value) => {
      slots.set(ref, { ref, value });
    },
    has: (ref) => slots.has(ref),
    waiting: () => [...slots.values()],
    took: (taken) => {
      for (const slot of taken) {
        // BY IDENTITY: `slots.get` answers whatever is there NOW, and a
        // replace that landed while the wake was on the wire put a different
        // object in. Only the one that was actually delivered is removed.
        if (slots.get(slot.ref) === slot) slots.delete(slot.ref);
      }
    },
    withdraw: (ref) => slots.delete(ref),
    refs: () => [...slots.keys()],
    clear: () => {
      slots.clear();
    },
  };
};
