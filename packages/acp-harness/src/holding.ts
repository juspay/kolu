/**
 * WHICH CONVERSATION — whatever the caller says one is.
 *
 * An opaque value with a `keyOf` beside it: olai's is the agent-and-session
 * pair, and kolu has exactly one conversation, so its address is a constant.
 * A caller that put two different values behind one string would be a caller
 * whose two conversations share a held list.
 */
export type AddressOf<Address> = (to: Address) => string;

/**
 * One body waiting, and whose door it came through.
 *
 * `under` is the SENDER'S OWN WORD, verbatim, and `undefined` for a body sent
 * without one. It is never asked about on its own: the only question anybody
 * asks is whether another body from the same {@link Slot.from} named the same
 * word.
 */
export interface Slot<Value, From = string> {
  /** Who sent it, as data — what the row is marked with when this body is
   *  handed over, and the half of the coalescing pair that keeps two senders'
   *  words apart. */
  readonly from: From;
  /** The body, AS THE SENDER LEFT IT. kolu keeps the value itself; olai keeps a
   *  THUNK, because a body that waited through a turn is about a world that has
   *  had a turn to move ({@link joined} asks it at the moment it is written). */
  readonly value: Value;
  readonly under: string | undefined;
}

export interface HoldingOptions<Address> {
  readonly keyOf: AddressOf<Address>;
  /** How many bodies ONE sender may have waiting for ONE conversation before
   *  the oldest is dropped. `undefined` is no cap: kolu's list is one slot per
   *  watched terminal, and the watch list is the bound. */
  readonly slots?: number | undefined;
  /** ... and how many CONVERSATIONS are held for at all, evicted
   *  least-recently-held-for. `undefined` is no cap: kolu has one. */
  readonly conversations?: number | undefined;
}

/**
 * THE HELD BODIES — put one in, read what is waiting, take what was handed over.
 *
 * Five verbs and no `flush`: draining is a DECISION about a live agent and a
 * running turn, and it belongs where those are known. What this holds is a list,
 * and the only thing it decides is where a body goes in it.
 */
export interface Held<Address, Value> {
  /**
   * One more body for that conversation — appended, or REPLACING IN PLACE the
   * one already there under the same key.
   *
   * `under` is the sender's own word or nothing at all; the identity it is
   * turned into is this module's (see the header).
   */
  readonly hold: (
    to: Address,
    from: string,
    value: Value,
    under: string | undefined,
  ) => void;
  /** What is waiting for that conversation, oldest first.
   *
   * The array is the CALLER'S to hand back to {@link Held.took} verbatim. That
   * is what makes a flush safe against a body arriving while it is on the wire:
   * what is taken is exactly what was offered, by identity, so a slot that
   * appeared in between stays. */
  readonly waiting: (to: Address) => ReadonlyArray<Slot<Value>>;
  /** ... and those ones landed, so they stop waiting. Slots that are no longer
   *  there — a coalescing replace that overtook the flush — are silently not
   *  removed twice.
   *
   *  BY IDENTITY rather than by index or by key: a coalescing replace that
   *  landed while the flush was on the wire wrote a NEW slot object into that
   *  position, and taking it would drop words nobody ever saw. */
  readonly took: (to: Address, taken: ReadonlyArray<Slot<Value>>) => void;
  /** ... AND THAT SENDER'S DOORBELL WAS TURNED OFF, so what it is holding for
   *  that conversation stops waiting.
   *
   *  The one verb here that throws words away, and it is owed: a message that
   *  arrived after a person cleared the doorbell because it had been queued
   *  before the clear would be the control lying about itself.
   *
   *  NOTHING IS LOST BY IT, which is why dropping is honest here where it would
   *  not be for words a person typed: a held body is a fresh derivation of what
   *  is standing right now, so the next derivation says everything this one
   *  would have said. */
  readonly dropped: (to: Address, from: string) => void;
  /** How many bodies each sender has waiting for that conversation — the
   *  numeral a strip draws, and the only thing core supplies about it. */
  readonly counts: (to: Address) => ReadonlyMap<string, number>;
  /** Whether that sender's key has anything waiting. Read by a caller putting
   *  back a body whose delivery failed: newer news must win over the retry. */
  readonly has: (to: Address, from: string, under?: string) => boolean;
  /** ... and WHAT is waiting for it, or `undefined`. Read by the one caller that
   *  has to know WHICH body it would be throwing away before it throws it
   *  ({@link Held.withdraw}). */
  readonly peek: (
    to: Address,
    from: string,
    under?: string,
  ) => Value | undefined;
  /** What is waiting, oldest first, as sender-key pairs — the strip's own list
   *  of what rang, and the `held` a status line counts. */
  readonly refs: (to: Address) => ReadonlyArray<string>;
  /** ... AND THAT SENDER WENT BACK TO WORK, so what it was going to say stops
   *  waiting. The one verb here a caller reaches for on its own initiative
   *  rather than because somebody turned something off. Answers whether
   *  anything was actually withdrawn. */
  readonly withdraw: (to: Address, from: string, under?: string) => boolean;
  /** Nothing is waiting any more — for that conversation, or (with no address)
   *  for any of them. */
  readonly clear: (to?: Address) => void;
}

export const holding = <Address, Value>(
  options: HoldingOptions<Address>,
): Held<Address, Value> => {
  const held = new Map<string, Array<Slot<Value>>>();

  const listFor = (address: string): Array<Slot<Value>> => {
    const already = held.get(address);
    if (already !== undefined) {
      held.delete(address);
      held.set(address, already);
      return already;
    }
    const fresh: Array<Slot<Value>> = [];
    held.set(address, fresh);
    const cap = options.conversations;
    if (cap === undefined) return fresh;
    while (held.size > cap) {
      const oldest = held.keys().next().value;
      if (oldest === undefined) break;
      held.delete(oldest);
    }
    return fresh;
  };

  const keeping = (to: Address, keep: (slot: Slot<Value>) => boolean): void => {
    const address = options.keyOf(to);
    const slots = held.get(address);
    if (slots === undefined) return;
    const left = slots.filter(keep);
    if (left.length === 0) held.delete(address);
    else held.set(address, left);
  };

  const coalescing = (
    slots: ReadonlyArray<Slot<Value>>,
    from: string,
    under: string | undefined,
  ): number =>
    under === undefined
      ? -1
      : slots.findIndex((slot) => slot.from === from && slot.under === under);

  const found = (
    slots: ReadonlyArray<Slot<Value>>,
    from: string,
    under: string | undefined,
  ): number =>
    slots.findIndex(
      (slot) =>
        slot.from === from && (under === undefined || slot.under === under),
    );

  return {
    hold: (to, from, value, under) => {
      const slots = listFor(options.keyOf(to));
      const at = coalescing(slots, from, under);
      const slot: Slot<Value> = { from, value, under };
      if (at !== -1) {
        slots[at] = slot;
        return;
      }
      slots.push(slot);
      const cap = options.slots;
      if (cap === undefined) return;
      let mine = 0;
      for (const one of slots) if (one.from === from) mine++;
      if (mine <= cap) return;
      const drop = slots.findIndex((one) => one.from === from);
      if (drop !== -1) slots.splice(drop, 1);
    },
    waiting: (to) => [...(held.get(options.keyOf(to)) ?? [])],
    took: (to, taken) => keeping(to, (slot) => !taken.includes(slot)),
    dropped: (to, from) => keeping(to, (slot) => slot.from !== from),
    counts: (to) => {
      const counted = new Map<string, number>();
      for (const slot of held.get(options.keyOf(to)) ?? []) {
        counted.set(slot.from, (counted.get(slot.from) ?? 0) + 1);
      }
      return counted;
    },
    has: (to, from, under) =>
      found(held.get(options.keyOf(to)) ?? [], from, under) !== -1,
    peek: (to, from, under) => {
      const slots = held.get(options.keyOf(to)) ?? [];
      const at = found(slots, from, under);
      return at === -1 ? undefined : slots[at]?.value;
    },
    refs: (to) => [
      ...new Set((held.get(options.keyOf(to)) ?? []).map((slot) => slot.from)),
    ],
    withdraw: (to, from, under) => {
      const address = options.keyOf(to);
      const slots = held.get(address);
      if (slots === undefined) return false;
      const at = found(slots, from, under);
      if (at === -1) return false;
      keeping(to, (slot) => slot !== slots[at]);
      return true;
    },
    clear: (to) => {
      if (to === undefined) {
        held.clear();
        return;
      }
      held.delete(options.keyOf(to));
    },
  };
};

/**
 * THE BODIES, AS ONE MESSAGE — asked for NOW, and only the ones that still have
 * something to say.
 *
 * Each slot is asked at the moment the row is written, which is the whole point
 * of holding a thunk rather than a string: a body that waited through a turn is
 * about a world that has had a turn to move. A slot that answers `null` has lost
 * its subject and is simply not in the message; if none of them answers, there
 * is no message, and the caller writes no row at all rather than an empty one.
 *
 * Whole paragraphs with a blank line between them, in the order they arrived.
 * There is no lead-in, no count, no "3 events" — every word a person reads here
 * is a word the sender wrote.
 */
export const joined = <Value>(
  slots: ReadonlyArray<Slot<Value>>,
  say: (value: Value) => string | null,
): string | null => {
  const said: Array<string> = [];
  for (const slot of slots) {
    const words = say(slot.value);
    if (words !== null && words !== "") said.push(words);
  }
  return said.length === 0 ? null : said.join("\n\n");
};
