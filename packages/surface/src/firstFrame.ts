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
 * The single axis in the plain readers is the snapshot contract; the only thing
 * that varies per consumer is the empty-stream POLICY — an empty stream means "no
 * snapshot ever arrived", which some callers treat as a benign "no value yet" and
 * others as a hard link/protocol failure. That policy is the parameter, captured
 * by two thin named exports so the contract assumption lives in one place:
 *
 *   - `firstFrameOrUndefined` — empty stream ⇒ `undefined` (benign absence).
 *   - `firstFrameOrThrow`     — empty stream ⇒ fail (a missing snapshot is a
 *                               failure; collapsing it to `undefined` would hide
 *                               a broken link — see `.agency/code-police.md` →
 *                               caught-error-must-not-collapse-to-empty).
 *
 * **Both readers are EFFECTS, and that is the interruption story.** A consumer
 * composes the read inside its own program — a concurrent fold, a bounded wait, a
 * CLI command that must die on SIGINT — and the read stays INSIDE the fiber tree
 * that bounds it. There is no `AbortSignal` to thread and none to forget:
 * cancellation is interruption (D10/#18), and interrupting the read tears its
 * subscription down through the stream's own finalizers. That is the same reason
 * {@link firstFrameOfCollectionItem} has always been an Effect.
 */

import { Data, Effect, Option, Stream } from "effect";

/** The first frame `stream` yields, or `undefined` if it ends empty.
 *
 *  `Stream.runHead` takes the head and INTERRUPTS the rest, and interruption IS
 *  the unsubscribe — so this one-shot read tears its own subscription down, and
 *  interrupting the READ (a race lost, a scope closed, a SIGINT) tears it down
 *  too. */
export function firstFrameOrUndefined<T>(
  stream: Stream.Stream<T, unknown>,
): Effect.Effect<T | undefined, unknown> {
  return Effect.map(Stream.runHead(stream), Option.getOrUndefined);
}

/** The first frame `stream` yields; FAILS with `onEmptyMessage` if the stream ends
 *  without ever yielding a snapshot frame.
 *
 *  The empty case is a failure and not an `undefined`, because a member that
 *  opened and closed without a snapshot is a dropped link, and collapsing it would
 *  hide one (caught-error-must-not-collapse-to-empty). */
export function firstFrameOrThrow<T>(
  stream: Stream.Stream<T, unknown>,
  onEmptyMessage: string,
): Effect.Effect<T, unknown> {
  return Effect.flatMap(Stream.runHead(stream), (head) =>
    Option.isSome(head)
      ? Effect.succeed(head.value)
      : Effect.fail(new NoSnapshotFrame({ message: onEmptyMessage })),
  );
}

/** The empty-open failure {@link firstFrameOrThrow} raises — a member that
 *  opened and closed WITHOUT its snapshot.
 *
 *  TAGGED, not a bare `Error`, because a reader has to tell it from the stream's
 *  OWN error channel and the two mean opposite things: this one says the link
 *  went away mid-read (nothing answered), while a declared member error says the
 *  far side answered and the answer was no. A reader that caught this function's
 *  whole failure channel and re-worded it billed every declared refusal as an
 *  unreachable endpoint — `@kolu/surface-cli` did exactly that, so a one-shot
 *  `get` reported a refusal on the exit code that means "try a different
 *  socket", while the same refusal under `--follow` reported it correctly.
 *
 *  `Data.TaggedError`, not `Schema.TaggedError`: it never crosses a wire. It is
 *  raised by a reader, on the reading side, about the read. */
export class NoSnapshotFrame extends Data.TaggedError("NoSnapshotFrame")<{
  readonly message: string;
}> {}

/** Is this failure {@link firstFrameOrThrow}'s empty open, rather than the
 *  stream's own error? The one predicate a reader discriminates on, so no
 *  consumer re-derives it from a message or from `instanceof` across a package
 *  boundary. */
export function isNoSnapshotFrame(error: unknown): error is NoSnapshotFrame {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { readonly _tag?: unknown })._tag === "NoSnapshotFrame"
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

/** The deadline a one-shot collection-item read is bounded by when its caller
 *  has no reason of its own to pick one.
 *
 *  It lives HERE, beside the reader it bounds, because every projecting face
 *  needs the same number for the same reason and none of them knows anything
 *  the others don't: "how long may a local read wait before it must say it
 *  cannot tell" is a property of the held-open-on-absent semantic this module
 *  guards, not of MCP or of argv. Both faces spelled it `5_000` independently
 *  before this constant existed. It stays a PARAMETER on
 *  {@link firstFrameOfCollectionItem} for a caller that genuinely has a
 *  different budget — a request already carrying a shorter deadline of its own. */
export const ITEM_READ_DEADLINE_MS = 5_000;

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
              error: new NoSnapshotFrame({ message: onEmptyItem }),
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
