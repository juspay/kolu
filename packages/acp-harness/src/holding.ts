/**
 * WHAT A DOORBELL SAID THAT IS NOT AT THE AGENT YET — the held bodies, in
 * arrival order, per conversation.
 *
 * A plugin (or kolu's own watch) can put a sentence into a conversation, and
 * there are two moments at which the end that owns the conversation cannot hand
 * one over: a turn is running, or nobody is in that conversation at all. This
 * module is what is held in between. WHICH of the three arms a body takes is the
 * caller's decision, taken under permits this file knows nothing about.
 *
 * ## Why holding is not the queue that was deleted
 *
 * A mid-turn prompt used to go into an array, wait for the turn to end, and be
 * thrown away by the next cancel — destroying USER WORDS with no copy anywhere
 * (#194). That argument is about words a person typed and has no second copy of.
 * A held body is a MACHINE'S DERIVATION of state that is still true: it was
 * composed from what the sender can see right now, and a sender whose subject is
 * still in that state derives it again on its next tick. So the words here are
 * re-creatable where a person's are not, and the reason the queue had to go does
 * not reach them.
 *
 * What IS the same is the cost of getting it wrong, which is why the two caps
 * below are counts and not policies: a conversation nobody opens for a week must
 * not grow an unbounded array of sentences nobody will read.
 *
 * ## Replace IN PLACE, and never append-and-drop
 *
 * A sender that sends a fresh whole sentence per event and marks them with one
 * {@link Held.hold} key gets ONE held body — the newest — sitting where the
 * FIRST one sat. Keeping the position is what makes arrival order survive the
 * replacing: a doorbell that re-derived its digest three times would otherwise
 * walk to the end of the list and be read after a wake that arrived before it.
 *
 * The key is MATCHED AS A PAIR — the sender, and the sender's own word — and
 * never as the word alone. Two senders that both call their coalescing key
 * `digest` are two senders with two subjects, and one silently swallowing the
 * other's sentence is the bug this pairing is the absence of. A body sent with
 * NO key is matched against nothing at all, so it never replaces and is never
 * replaced — the arm for a sentence that is about a moment and cannot be
 * re-derived.
 *
 * ## Two products, one list
 *
 * kolu holds per TERMINAL (its sender is a watched terminal and its word is the
 * terminal itself, so it holds one slot per ref and the list is bounded by the
 * watch list), for ONE conversation and with no cap at all. olai holds per
 * PLUGIN, for any number of conversations, and bounds both axes. The two are
 * this file's parameters: a conversation ADDRESS the caller defines, the two
 * caps where `undefined` means "no cap" — and kolu's four extra verbs
 * ({@link Held.has}, {@link Held.peek}, {@link Held.refs}, {@link Held.clear})
 * and its {@link Held.withdraw}, which a caller that put a body back after a
 * failed delivery, or that watched a terminal go back to work, cannot say
 * without.
 *
 * ## Memory only, and it says so here rather than only in the PR
 *
 * Nothing in this module reaches a disk. A restart comes back holding nothing,
 * which is honest and is not a loss: whatever derived these bodies re-observes
 * its own subject and rings again.
 *
 * ## Its own module, for `./turns.ts`'s reason
 *
 * Every rule above is reachable through the real thing only by starting a
 * subprocess, holding a turn open and having somebody ring — so the rules live
 * where a test can call them.
 */

/**
 * WHICH CONVERSATION — whatever the caller says one is.
 *
 * An opaque value with a `keyOf` beside it: olai's is the agent-and-session
 * pair, and kolu has exactly one conversation, so its address is a constant.
 * A string rather than a generic because a `Map` needs one, and a caller that
 * put two different values behind one string would be a caller whose two
 * conversations share a held list.
 */
export type AddressOf<Address> = (to: Address) => string;

/** ... and the map key one conversation is filed under. `\0` cannot occur in
 *  either half of olai's pair and kolu's constant has none, and it is written as
 *  an ESCAPE rather than as the byte: a literal NUL makes this file read as
 *  BINARY to review tooling, which is how a reviewer stops being able to see
 *  it. */

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
  /** Insertion-ordered, which is what makes the conversation cap's eviction a
   *  read of the map rather than a second table of timestamps. */
  const held = new Map<string, Array<Slot<Value>>>();

  /** That conversation's list, made and MOVED TO THE END: holding for a
   *  conversation is the touch the cap's eviction order is about. */
  const listFor = (address: string): Array<Slot<Value>> => {
    const already = held.get(address);
    if (already !== undefined) {
      held.delete(address);
      held.set(address, already);
      return already;
    }
    const fresh: Array<Slot<Value>> = [];
    held.set(address, fresh);
    // The OLDEST conversation goes, which with the re-insertion above is the one
    // held for longest ago. A `Map` iterates in insertion order.
    const cap = options.conversations;
    if (cap === undefined) return fresh;
    while (held.size > cap) {
      const oldest = held.keys().next().value;
      if (oldest === undefined) break;
      held.delete(oldest);
    }
    return fresh;
  };

  /**
   * THE SLOTS THAT PASS STAY, and a conversation left holding none stops being
   * held for at all — everything {@link Held.took} and {@link Held.dropped} do
   * apart from their one predicate.
   *
   * DELETING THE EMPTIED KEY is the part worth having once: a conversation whose
   * last body was taken stops occupying one of the conversations the cap allows,
   * and two copies of that rule is one of them missed — a `took` that emptied a
   * list and left the key behind would fill the map with empty arrays and evict
   * conversations that really are holding something to make room for them.
   *
   * `set` on the key it already has, and never `delete` then `set`: insertion
   * order IS the eviction order, and `Map.set` on a present key replaces the
   * value while keeping the position. Taking a body that landed is not HOLDING
   * for a conversation, so it may not count as the touch that pushes an older
   * one out.
   */
  const keeping = (to: Address, keep: (slot: Slot<Value>) => boolean): void => {
    const address = options.keyOf(to);
    const slots = held.get(address);
    if (slots === undefined) return;
    const left = slots.filter(keep);
    if (left.length === 0) held.delete(address);
    else held.set(address, left);
  };

  /** WHERE a new body files itself: the same sender under the same word.
   *  `undefined` is no word at all, and a body sent without one matches
   *  nothing — so it never replaces and is never replaced. */
  const coalescing = (
    slots: ReadonlyArray<Slot<Value>>,
    from: string,
    under: string | undefined,
  ): number =>
    under === undefined
      ? -1
      : slots.findIndex((slot) => slot.from === from && slot.under === under);

  /** WHERE a question about a sender's bodies looks. `undefined` there means
   *  "that sender's first body, whatever it was filed under" — which is what a
   *  caller with one slot per sender asks ({@link Held.has}, {@link Held.peek},
   *  {@link Held.withdraw}), and what a caller with keys asks by naming one. */
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
      // THE PAIR, compared rather than spelled: a body replaces one already
      // waiting only when the SAME sender named the SAME word. A body sent with
      // no word is compared against nothing at all, so it never replaces and is
      // never replaced.
      const at = coalescing(slots, from, under);
      const slot: Slot<Value> = { from, value, under };
      // IN PLACE, which is the whole of the coalescing rule: the newest value
      // lands where the first one under this key landed, so a sender that
      // re-derives its sentence does not walk to the back of the queue.
      if (at !== -1) {
        slots[at] = slot;
        return;
      }
      slots.push(slot);
      // ... and the cap is per SENDER, because two senders ringing one
      // conversation are two subjects and one must not evict the other's words.
      const cap = options.slots;
      if (cap === undefined) return;
      let mine = 0;
      for (const one of slots) if (one.from === from) mine++;
      if (mine <= cap) return;
      const drop = slots.findIndex((one) => one.from === from);
      if (drop !== -1) slots.splice(drop, 1);
    },
    // A COPY. The list behind this is the one `hold` mutates in place, so a
    // caller that kept the result across an await and handed it back would be
    // handing back whatever landed in between — and `took`'s identity filter
    // would take the very slots it exists to leave alone.
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
    // A ref is what a reader sees in the strip: WHICH SENDER rang, once each,
    // in the order they first rang — a coalescing replace keeps its position, so
    // a sender that re-derived three times is still at the front.
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
