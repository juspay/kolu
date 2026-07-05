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
 *  value, or `{ present: false }` when the key is not (or no longer) a member. A
 *  typed sum so "present with value `undefined`" and "absent" can never collapse
 *  to one nullable hole. */
export type CollectionItemFrame<T> =
  | { readonly present: true; readonly value: T }
  | { readonly present: false };

/** One-shot read of a collection ITEM, BOUNDED against `collectionHandlers.get`'s
 *  held-open-on-absent semantic (#1681). The item `get` yields nothing until the
 *  key is a member, so `firstFrameOrThrow(itemGet)` ALONE hangs forever on a
 *  not-yet-present key — THIS is the safe reader for that case, and it lives in
 *  the framework beside the footgun it guards so no consumer re-derives it.
 *
 *  Race the item `get`'s first frame against a LIVE `keys` subscription that
 *  reports absence: a `keys` frame that OMITS the key (absent at the snapshot, OR
 *  removed at any later instant — which also closes the DELETE-RACE a one-time
 *  check-then-`get` would leave open) resolves `{ present: false }`; a PRESENT key
 *  yields its `get` snapshot immediately and wins. Whichever settles first aborts
 *  the other via a local `AbortController` chained to `signal`, so the loser is
 *  always torn down (and its post-abort rejection is handled by `Promise.race`,
 *  never surfacing as an unhandled rejection).
 *
 *  Throws `onEmptyItem` ONLY when a PRESENT item's `get` opens empty — a dropped
 *  bridge link, not an empty value (the same snapshot-first contract
 *  `firstFrameOrThrow` enforces), never collapsed to a silent absent. `openKeys`
 *  must yield the collection's membership arrays; membership is `Array.includes`
 *  (SameValueZero), matching the collection's primitive-key channel identity. */
export async function firstFrameOfCollectionItem<T>(
  openItem: (
    signal: AbortSignal,
  ) => Promise<AsyncIterable<T> | null | undefined>,
  openKeys: (signal: AbortSignal) => Promise<AsyncIterable<unknown>>,
  key: unknown,
  onEmptyItem: string,
  signal: AbortSignal | undefined,
): Promise<CollectionItemFrame<T>> {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal !== undefined) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const present = (async (): Promise<CollectionItemFrame<T>> => {
      const source = await openItem(ac.signal);
      if (source === null || source === undefined) {
        throw new Error(onEmptyItem);
      }
      return {
        present: true,
        value: await firstFrameOrThrow(source, onEmptyItem),
      };
    })();
    const absent = (async (): Promise<CollectionItemFrame<T>> => {
      const source = await openKeys(ac.signal);
      for await (const frame of source) {
        if (!(Array.isArray(frame) && frame.includes(key))) {
          return { present: false };
        }
      }
      // `keys` ended without ever reporting the key absent — for a live surface
      // this only happens on teardown; treat as not-found so the read stays
      // bounded rather than resolving a value the collection no longer holds.
      return { present: false };
    })();
    return await Promise.race([present, absent]);
  } finally {
    ac.abort();
    if (signal !== undefined) signal.removeEventListener("abort", onAbort);
  }
}
