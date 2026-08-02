/**
 * Read the first frame of a snapshot-then-delta stream — a cell subscription, a
 * PRESENT-key collection `get`, and a collection `keys` all OPEN with a snapshot
 * frame, so "the first value the stream yields" is the current snapshot.
 *
 * Every member verb hands back a LAZY `Stream` (D10/#18), so these readers take
 * a `Stream` DIRECTLY. They used to take an `AsyncIterable`, which meant every
 * consumer wrote the same `Stream.toAsyncIterable` bridge in front of the call;
 * the bridge is gone from all six of them and lives here once, as
 * `Stream.runHead` — which takes the head and then INTERRUPTS the rest, and
 * interruption IS the unsubscribe, so a one-shot read still tears its own
 * subscription down.
 *
 * EXCEPTION (#1681): a collection `get` for a key that is NOT a member yet is a
 * held-open subscription that yields NOTHING until the key's first upsert (see
 * `collectionHandlers.get`), so it has no opening snapshot to read one-shot. A
 * one-shot reader that might target an absent key must therefore NOT block on
 * `firstFrameOrThrow` alone — it must bound the read against membership (the
 * `keys` stream) and a deadline, or it hangs. `firstFrameOfCollectionItem`
 * (below) is that bounded reader — the safe one-shot collection-item read lives
 * here, next to the `firstFrameOrThrow` footgun it guards, so no consumer has to
 * re-derive the get-vs-keys-absence race (or hit the hang).
 *
 * **Two faces, one contract, and the split is the interruption story.** The two
 * plain readers RESOLVE A PROMISE, because their consumers are the non-Effect
 * leaves locked decision 1 keeps plain-async (a TUI's one-shot read, a dial
 * handshake) — this is their sanctioned `Effect.runPromise` edge, held in one
 * place instead of once per CLI. {@link firstFrameOfCollectionItem} returns an
 * EFFECT, because both of its consumers compose it inside a larger program
 * (kolu-server folds a host's terminals concurrently; surface-mcp runs the whole
 * `resources/read` under the request's abort signal) and crossing a Promise edge
 * mid-program would detach the read from the interruption that bounds it.
 *
 * The single axis in the two plain readers is the snapshot contract; the only
 * thing that varies per consumer is the empty-stream POLICY — an empty stream
 * means "no snapshot ever arrived", which some callers treat as a benign "no
 * value yet" and others as a hard link/protocol failure. That policy is the
 * parameter, captured by two thin named exports over one shared core so the
 * contract assumption lives in one place:
 *
 *   - `firstFrameOrUndefined` — empty stream ⇒ `undefined` (benign absence).
 *   - `firstFrameOrThrow`     — empty stream ⇒ throw (a missing snapshot is a
 *                               failure; collapsing it to `undefined` would hide
 *                               a broken link — see `.agency/code-police.md` →
 *                               caught-error-must-not-collapse-to-empty).
 */

import { Effect, Option, Stream } from "effect";

/** The framework's ONE Promise edge for a one-shot snapshot read (PLAN D10/#25).
 *
 *  `signal` is the AbortSignal seam: the non-Effect scaffolds that drive these
 *  reads (padi's `runWait`, a CLI's own cancellation) speak AbortSignal, and
 *  `Effect.runPromise`'s `signal` option translates an abort into fiber
 *  interruption — which tears the subscription down and rejects the read, so a
 *  caller that gave up never waits out a wedged-but-retrying link. Omitted for a
 *  read the stream itself bounds. */
function runOneShot<A>(
  effect: Effect.Effect<A, unknown>,
  signal: AbortSignal | undefined,
): Promise<A> {
  return Effect.runPromise(
    effect,
    signal === undefined ? undefined : { signal },
  );
}

/** The first frame `stream` yields, or `undefined` if it ends empty. */
export function firstFrameOrUndefined<T>(
  stream: Stream.Stream<T, unknown>,
  signal?: AbortSignal,
): Promise<T | undefined> {
  return runOneShot(
    Effect.map(Stream.runHead(stream), Option.getOrUndefined),
    signal,
  );
}

/** The first frame `stream` yields; rejects with `onEmptyMessage` if the stream
 *  ends without ever yielding a snapshot frame. */
export function firstFrameOrThrow<T>(
  stream: Stream.Stream<T, unknown>,
  onEmptyMessage: string,
  signal?: AbortSignal,
): Promise<T> {
  return runOneShot(
    Effect.flatMap(Stream.runHead(stream), (head) =>
      Option.isSome(head)
        ? Effect.succeed(head.value)
        : Effect.fail(new Error(onEmptyMessage)),
    ),
    signal,
  );
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

/** What one arm of the bounded race settles with.
 *
 *  Every arm SUCCEEDS with one of these — including the failure arm. That is
 *  deliberate: `Effect.raceAll` ignores an early FAILURE and keeps waiting for a
 *  success, so a genuinely broken item read expressed as a failure would lose the
 *  race to the deadline and be reported as a benign "not present". Carrying the
 *  failure as a value and re-raising it after the race keeps a dropped link loud
 *  (caught-error-must-not-collapse-to-empty). */
type ItemRead<T> =
  | CollectionItemFrame<T>
  | {
      readonly present: false;
      readonly reason: "failed";
      readonly error: unknown;
    };

/** One-shot read of a collection ITEM, BOUNDED against `collectionHandlers.get`'s
 *  held-open-on-absent semantic (#1681). The item `get` yields nothing until the
 *  key is a member, so `firstFrameOrThrow(itemGet)` ALONE hangs forever on a
 *  not-yet-present key — THIS is the safe reader for that case, and it lives in
 *  the framework beside the footgun it guards so no consumer re-derives it.
 *
 *  Race the item's first frame against BOTH absence bounds — always both, never
 *  one or the other. They answer different questions and neither subsumes the
 *  other, and wiring them as EITHER/OR left a gap exactly between them: a
 *  keys-bearing collection had no deadline at all, so a key that STAYS a member
 *  while its item stream says nothing matched no bound and the read never
 *  resolved — the very hang this function exists to make unspellable.
 *
 *   - **membership** (when `keys` is given): a LIVE `keys` subscription that
 *     reports absence — a `keys` frame that OMITS the key (absent at the
 *     snapshot, OR removed at any later instant, which also closes the DELETE-RACE
 *     a one-time check-then-`get` would leave open) resolves
 *     `{ present: false, reason: "absent" }`. Precise and immediate, and the only
 *     bound that can say something true about the ITEM. A keys-LESS collection
 *     (`keys === null`) has no such signal at all.
 *   - **the deadline** (always): a hard `deadlineMs` timeout resolving
 *     `{ present: false, reason: "deadline" }`. The backstop, and the only thing
 *     standing between a quiet producer and an unbounded read. This is the
 *     EXPLICIT, typed, caller-loggable bound — never a silent hang, never a silent
 *     fall-back to the `firstFrameOrThrow(get)` footgun.
 *
 *  `Effect.raceAll` interrupts the losing arms, so whichever bound answers first
 *  tears the others' subscriptions down through their own finalizers — the
 *  chained `AbortController` this used to hand-roll, performed by the runtime.
 *
 *  FAILS with `onEmptyItem` when a PRESENT item's stream opens but yields no
 *  snapshot frame — a dropped link, not an empty value (the same snapshot-first
 *  contract `firstFrameOrThrow` enforces), never collapsed to a silent absent.
 *
 *  `keys` yields the collection's membership arrays; membership is decided by
 *  `Array.includes` (SameValueZero) between the decoded `key` and the RAW keys in
 *  each frame — sound for the primitive key types (`string`/`number`/`boolean`)
 *  the `keys` stream carries, because `key` is decoded to that same raw type. (It
 *  does NOT go through the channel's `String(k)` identity — the frame holds raw
 *  keys, not their stringified channel names.) */
export function firstFrameOfCollectionItem<T>(
  item: Stream.Stream<T, unknown>,
  keys: Stream.Stream<unknown, unknown> | null,
  key: unknown,
  onEmptyItem: string,
  deadlineMs: number,
): Effect.Effect<CollectionItemFrame<T>, unknown> {
  const failed = (error: unknown): Effect.Effect<ItemRead<T>> =>
    Effect.succeed({ present: false, reason: "failed", error });

  const itemArm = Effect.catch(
    Effect.map(
      Stream.runHead(item),
      (head): ItemRead<T> =>
        Option.isSome(head)
          ? { present: true, value: head.value }
          : {
              present: false,
              reason: "failed",
              error: new Error(onEmptyItem),
            },
    ),
    failed,
  );

  // A `keys` stream that ends without ever reporting the key absent only happens
  // on teardown for a live surface — `runHead` over the filtered stream then
  // yields `None`, which is treated as absence too rather than leaving the read
  // resolving a stale value.
  const membershipArm: Effect.Effect<ItemRead<T>>[] =
    keys === null
      ? []
      : [
          Effect.catch(
            Effect.as(
              Stream.runHead(
                Stream.filter(
                  keys,
                  (frame) => !(Array.isArray(frame) && frame.includes(key)),
                ),
              ),
              { present: false, reason: "absent" } as ItemRead<T>,
            ),
            failed,
          ),
        ];

  const deadlineArm = Effect.as(Effect.sleep(deadlineMs), {
    present: false,
    reason: "deadline",
  } as ItemRead<T>);

  return Effect.flatMap(
    Effect.raceAll<Effect.Effect<ItemRead<T>>>([
      itemArm,
      ...membershipArm,
      deadlineArm,
    ]),
    (outcome): Effect.Effect<CollectionItemFrame<T>, unknown> =>
      !outcome.present && outcome.reason === "failed"
        ? Effect.fail(outcome.error)
        : Effect.succeed(outcome as CollectionItemFrame<T>),
  );
}
