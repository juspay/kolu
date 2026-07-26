/**
 * Read the first frame of a snapshot-then-delta stream — a cell subscription, a
 * PRESENT-key collection `get`, and a collection `keys` all OPEN with a snapshot
 * frame, so "the first value the stream yields" is the current snapshot.
 *
 * EXCEPTION (#1681): a collection `get` for a key that is NOT a member yet is a
 * held-open subscription that yields NOTHING until the key's first upsert (see
 * `collectionHandlers.get`), so it has no opening snapshot to read one-shot. A
 * one-shot reader that might target an absent key must therefore NOT block on
 * `firstFrameOrThrow` alone — it must bound the read against membership (the
 * `keys` stream) and the request signal, or it hangs. `firstFrameOfCollectionItem`
 * (below) is that bounded reader — the safe one-shot collection-item read lives
 * here, next to the `firstFrameOrThrow` footgun it guards, so no consumer has to
 * re-derive the get-vs-keys-absence race (or hit the hang).
 *
 * The single axis here is the snapshot contract; the only thing that varies per
 * consumer is the empty-stream POLICY — an empty stream means "no snapshot ever
 * arrived", which some callers treat as a benign "no value yet" and others as a
 * hard link/protocol failure. That policy is the parameter, captured by two thin
 * named exports over one shared core so the contract assumption lives in one
 * place:
 *
 *   - `firstFrameOrUndefined` — empty stream ⇒ `undefined` (benign absence).
 *   - `firstFrameOrThrow`     — empty stream ⇒ throw (a missing snapshot is a
 *                               failure; collapsing it to `undefined` would hide
 *                               a broken link — see `.agency/code-police.md` →
 *                               caught-error-must-not-collapse-to-empty).
 *
 * Returning out of the loop closes the underlying subscription.
 */

/** The first value an async stream yields, or `undefined` if it ends empty. */
export async function firstFrameOrUndefined<T>(
  stream: AsyncIterable<T>,
): Promise<T | undefined> {
  for await (const frame of stream) return frame;
  return undefined;
}

/** The first value an async stream yields; throws `onEmptyMessage` if the stream
 *  ends without ever yielding a snapshot frame. */
export async function firstFrameOrThrow<T>(
  stream: AsyncIterable<T>,
  onEmptyMessage: string,
): Promise<T> {
  for await (const frame of stream) return frame;
  throw new Error(onEmptyMessage);
}

/** The outcome of a bounded one-shot collection-item read: the item's current
 *  value, or a typed absence carrying WHY it is absent — `"absent"` (membership
 *  confirmed it is not/no-longer a member) or `"deadline"` (the read ran out of
 *  time: either the collection has no membership signal to resolve against, or it
 *  has one that kept saying "still a member" while the item stream said nothing).
 *  The two are NOT interchangeable: `"absent"` is a fact about the item, while
 *  `"deadline"` is a fact about the READ, so a caller reaping on absence must
 *  treat only the first as evidence. A typed
 *  sum so "present with value `undefined`" and "absent" can never collapse to one
 *  nullable hole, and so a caller can LOG the uncertain `"deadline"` case distinctly
 *  rather than silently degrade it. */
export type CollectionItemFrame<T> =
  | { readonly present: true; readonly value: T }
  | { readonly present: false; readonly reason: "absent" | "deadline" };

/** One-shot read of a collection ITEM, BOUNDED against `collectionHandlers.get`'s
 *  held-open-on-absent semantic (#1681). The item `get` yields nothing until the
 *  key is a member, so `firstFrameOrThrow(itemGet)` ALONE hangs forever on a
 *  not-yet-present key — THIS is the safe reader for that case, and it lives in
 *  the framework beside the footgun it guards so no consumer re-derives it.
 *
 *  Race the item `get`'s first frame against BOTH absence bounds — always both,
 *  never one or the other. They answer different questions and neither subsumes
 *  the other, and wiring them as EITHER/OR left a gap exactly between them: a
 *  keys-bearing collection had no deadline at all, so a key that STAYS a member
 *  while its item stream says nothing matched no bound and the read never
 *  resolved — the very hang this function exists to make unspellable.
 *
 *   - **membership** (when `openKeys` is given): a LIVE `keys` subscription that
 *     reports absence — a `keys` frame that OMITS the key (absent at the
 *     snapshot, OR removed at any later instant, which also closes the DELETE-RACE
 *     a one-time check-then-`get` would leave open) resolves
 *     `{ present: false, reason: "absent" }`. Precise and immediate, and the only
 *     bound that can say something true about the ITEM. A keys-LESS collection
 *     (`openKeys === null`) has no such signal at all.
 *   - **the deadline** (always): a hard `deadlineMs` timeout resolving
 *     `{ present: false, reason: "deadline" }`. The backstop, and the only thing
 *     standing between a quiet producer and an unbounded read. This is the
 *     EXPLICIT, typed, caller-loggable bound — never a silent hang, never a silent
 *     fall-back to the `firstFrameOrThrow(get)` footgun.
 *
 *  Whichever settles first aborts the other via a local `AbortController` chained
 *  to `signal`, so the loser is always torn down (and its post-abort rejection is
 *  handled by `Promise.race`, never surfacing as an unhandled rejection).
 *
 *  Throws `onNullSource` when the item `get` resolves no streaming source at all,
 *  and `onEmptyItem` when a PRESENT item's `get` opens but yields no snapshot frame
 *  — both a dropped bridge link, not an empty value (the same snapshot-first
 *  contract `firstFrameOrThrow` enforces), never collapsed to a silent absent.
 *
 *  `openKeys` yields the collection's membership arrays; membership is decided by
 *  `Array.includes` (SameValueZero) between the decoded `key` and the RAW keys in
 *  each frame — sound for the primitive key types (`string`/`number`/`boolean`)
 *  the `keys` stream carries, because `key` is decoded to that same raw type. (It
 *  does NOT go through the channel's `String(k)` identity — the frame holds raw
 *  keys, not their stringified channel names.) */
export async function firstFrameOfCollectionItem<T>(
  openItem: (
    signal: AbortSignal,
  ) => Promise<AsyncIterable<T> | null | undefined>,
  openKeys: ((signal: AbortSignal) => Promise<AsyncIterable<unknown>>) | null,
  key: unknown,
  onEmptyItem: string,
  onNullSource: string,
  deadlineMs: number,
  signal: AbortSignal | undefined,
): Promise<CollectionItemFrame<T>> {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal !== undefined) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const present = (async (): Promise<CollectionItemFrame<T>> => {
      const source = await openItem(ac.signal);
      if (source === null || source === undefined) {
        throw new Error(onNullSource);
      }
      return {
        present: true,
        value: await firstFrameOrThrow(source, onEmptyItem),
      };
    })();
    // TWO absence bounds, and BOTH are always armed — they answer different
    // questions and neither subsumes the other:
    //
    //  - **membership** ("is this key gone?") — the precise answer, available
    //    only when the collection has a `keys` verb, and the one that resolves
    //    the instant a key leaves rather than after a wait;
    //  - **the deadline** ("have we waited long enough?") — the backstop.
    //
    // They used to be EITHER/OR, which left a gap exactly between them: a key
    // that STAYS a member while its item stream says nothing matched neither,
    // so a collection with a `keys` verb had no deadline at all and the read
    // never resolved. That is the hang this function exists to make unspellable,
    // reached through the one door left open — and callers put this read inside
    // poll cells, where a read that never resolves holds the in-flight latch and
    // stops the cell recomputing for the life of the process.
    const membership: Promise<CollectionItemFrame<T>>[] =
      openKeys === null
        ? []
        : [
            (async (): Promise<CollectionItemFrame<T>> => {
              const source = await openKeys(ac.signal);
              for await (const frame of source) {
                if (!(Array.isArray(frame) && frame.includes(key))) {
                  return { present: false, reason: "absent" };
                }
              }
              // `keys` ended without ever reporting the key absent — for a live
              // surface this only happens on teardown; treat as not-found so the
              // read stays bounded rather than resolving a stale value.
              return { present: false, reason: "absent" };
            })(),
          ];
    const deadline = new Promise<CollectionItemFrame<T>>((resolve) => {
      deadlineTimer = setTimeout(
        () => resolve({ present: false, reason: "deadline" }),
        deadlineMs,
      );
    });
    return await Promise.race([present, ...membership, deadline]);
  } finally {
    ac.abort();
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    if (signal !== undefined) signal.removeEventListener("abort", onAbort);
  }
}
