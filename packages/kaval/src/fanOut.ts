/**
 * Bounded, eager-subscribe fan-out — the primitive a `PtyHost` uses to hand one
 * PTY's output (and its OSC-derived metadata) to many independent consumers.
 *
 * Four properties earn this its own type rather than Effect's own `PubSub`:
 *
 *   1. **Subscribe and read, fused.** {@link FanOut.subscribeWith} registers the
 *      subscriber AND takes the caller's reading of the publisher's current
 *      state in ONE synchronous step. That is what makes `PtyHost.attach()`
 *      race-free — it subscribes and serializes with no step in between — and a
 *      caller CANNOT spell the two halves separately, so the partition is a fact
 *      of the type rather than a comment above two statements. (Two statements
 *      in an `Effect.gen` would not do: a fiber may yield between them once its
 *      op budget runs out, and a PTY chunk parsing in that gap would land in
 *      neither the reading nor the stream — or in both.)
 *
 *   2. **Drop-slow-subscriber, per subscriber.** Each subscriber buffers
 *      independently up to `maxQueue` items. A consumer that stops draining (a
 *      wedged browser tab on a chatty `data` stream) is DROPPED — its stream
 *      ends — rather than growing the buffer without bound and pinning server
 *      memory. The client's transparent re-subscribe then delivers a fresh
 *      snapshot. Bounded memory beats unbounded fidelity here.
 *
 *      `PubSub` cannot express this: its capacity and strategy are CHANNEL-wide,
 *      so a bounded pubsub backpressures every publisher and a dropping/sliding
 *      one sheds values for everyone. The contract here is drop THIS subscriber,
 *      end ITS stream, leave its siblings untouched — which is a set of
 *      independent bounded queues, one per subscriber.
 *
 *   3. **A second bound, in the unit that matters: BYTES** (kolu#2362). An item
 *      count is the wrong bound for a feed whose items are PTY reads: an agent
 *      that reprints its whole transcript on a SIGWINCH writes ~0.7 MB in a
 *      handful of 64 KiB chunks, which is nowhere near 10,000 items — so the
 *      item cap never fires and every one of those bytes is replayed to a viewer
 *      that only wanted the end. {@link FanOutByteBudget} measures each value and
 *      caps a subscriber's QUEUED (undelivered) total, so the publisher can set
 *      the bound at "more than a fresh snapshot would cost" and the drop becomes
 *      a SKIP-AHEAD rather than a last-resort memory guard. The budget is a
 *      callback, not a number, because the publisher's own cost moves (kaval
 *      derives it from the last bounded snapshot it serialized).
 *
 *      The two bounds are not redundant: bytes governs a chatty feed, the item
 *      count still bounds the per-entry queue overhead of a flood of tiny values.
 *      A fan-out with no budget (every metadata tap) keeps the item bound alone.
 *
 *   4. **The drop IS the stream's error.** A dropped subscriber's stream fails
 *      with {@link SubscriberOverflow} instead of ending, so a consumer cannot
 *      confuse "you lagged, re-attach" with "the PTY exited". It used to be an
 *      out-of-band `onOverflow` callback flipping a mutable flag the serving
 *      layer read after the loop; now it is the error channel, and "overflow is
 *      the last frame" holds by type. {@link FanOut.dropAllUnsafe} reuses that
 *      one channel for the publisher's own "what you have is worthless now"
 *      (kaval: a real PTY resize reflows the screen under every viewer), so a
 *      re-sync has ONE path in and no second frame kind to discriminate.
 */

import { Cause, Data, Effect, Queue, type Scope, Stream } from "effect";

/** Default per-subscriber buffered-item cap before drop-slow kicks in. */
const DEFAULT_MAX_QUEUE = 10_000;

/** Why a subscriber was dropped.
 *
 *  `items` / `bytes` are the two BOUNDS — this subscriber was not draining fast
 *  enough, in one unit or the other. `invalidated` is not a bound at all: the
 *  publisher declared every subscriber's buffered view worthless and asked them
 *  all to re-sync. The disposition is identical (re-attach for a fresh reading),
 *  which is why they share a channel; the word is what a log line needs to tell
 *  "a wedged consumer" from "the publisher moved under everyone". */
export type SubscriberDropReason = "items" | "bytes" | "invalidated";

/** THIS subscriber's buffered view is gone and it was dropped. Carried on its
 *  own stream's error channel — siblings are unaffected — so the serving layer
 *  turns it into a typed `overflow` frame and the consumer re-attaches for a
 *  fresh snapshot rather than reading the end as a PTY exit. */
export class SubscriberOverflow extends Data.TaggedError("SubscriberOverflow")<{
  readonly reason: SubscriberDropReason;
  /** The bound that was exceeded, in `reason`'s own unit — items or bytes.
   *  `null` for `invalidated`, which is a publisher decision and has no bound
   *  to report; spelled `null` rather than `0` so a log line cannot read as "the
   *  bound was zero". */
  readonly limit: number | null;
}> {}

/** A per-subscriber BYTE bound, measured by the publisher (property 3 above). */
export interface FanOutByteBudget<T> {
  /** This value's cost, in whatever unit `limit` is stated in. */
  readonly sizeOf: (value: T) => number;
  /** The most a subscriber may have QUEUED (offered but not yet pulled) before
   *  it is dropped. Read once per publish, so a publisher whose own cost moves
   *  (kaval's bounded snapshot grows with the screen) keeps the bound tied to it
   *  rather than to a constant that goes stale. */
  readonly limit: () => number;
}

export interface FanOutOptions<T> {
  /** Per-subscriber buffered-item cap. A subscriber that cannot take a value
   *  because its queue is full is dropped (its stream fails with
   *  {@link SubscriberOverflow}) rather than buffering forever. Defaults to
   *  10,000. */
  maxQueue?: number;
  /** Optional per-subscriber BYTE cap, checked after each offer. Omit it for a
   *  feed whose items are small and uniform (every metadata tap): the item cap
   *  alone bounds those. */
  byteBudget?: FanOutByteBudget<T>;
}

/** A live subscription: the stream of values published after it was registered,
 *  plus the caller's reading of publisher state taken in the SAME synchronous
 *  step. See {@link FanOut.subscribeWith}. */
export interface Subscription<T, R> {
  /** Values published AFTER this subscription was registered. Ends when the
   *  fan-out closes or the subscription's scope does; fails with
   *  {@link SubscriberOverflow} if this subscriber lagged past a bound or the
   *  publisher invalidated it. */
  readonly stream: Stream.Stream<T, SubscriberOverflow>;
  /** What `read()` returned, at the instant of registration. */
  readonly reading: R;
}

/** One live subscriber: its queue, and — under a byte budget — how much it has
 *  been offered but not yet pulled. */
interface Subscriber<T> {
  /** `Cause.Done` rides in the error type because ending a queue IS a `Done`
   *  failure; `Stream.fromQueue` excludes it again, so a subscriber sees only
   *  {@link SubscriberOverflow}. */
  readonly queue: Queue.Queue<T, SubscriberOverflow | Cause.Done>;
  /** Queued cost under a byte budget; always 0 without one. Incremented at the
   *  offer and decremented as the subscriber's own stream emits the value
   *  downstream — the closest observable moment to "it has been taken off our
   *  hands", and the only one this type can see (a `Queue` does not announce its
   *  takes). */
  bytes: number;
}

/** One publisher, many independently-bounded subscribers. */
export class FanOut<T> {
  private readonly subs = new Set<Subscriber<T>>();
  private closed = false;
  private readonly maxQueue: number;
  private readonly byteBudget: FanOutByteBudget<T> | undefined;

  constructor(options: FanOutOptions<T> = {}) {
    this.maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
    this.byteBudget = options.byteBudget;
  }

  /** Remove a subscriber from the live set and FAIL its stream. Removed first,
   *  so a later publish can never reach it, then whatever it had buffered is
   *  DISCARDED — deliberate: a dropped consumer re-attaches and gets a fresh
   *  reading, so replaying the stale values it never read is pointless.
   *  (Draining before the fail is what makes the failure immediate: a queue
   *  failed with messages still in it stays `Closing` until they are taken.) */
  private dropUnsafe(sub: Subscriber<T>, err: SubscriberOverflow): void {
    this.subs.delete(sub);
    sub.bytes = 0;
    while (Queue.sizeUnsafe(sub.queue) > 0) Queue.takeUnsafe(sub.queue);
    Queue.failCauseUnsafe(sub.queue, Cause.fail(err));
  }

  /** Synchronous fire-and-forget broadcast to every live subscriber — called
   *  straight from node-pty / xterm callbacks, which is why it is `Unsafe`
   *  (outside Effect) rather than an `Effect`. */
  publishUnsafe(value: T): void {
    if (this.closed) return;
    const budget = this.byteBudget;
    // Measured ONCE per publish, not once per subscriber: `sizeOf` is a pure
    // reading of the value and `limit()` a reading of the publisher, and both
    // are the same for every subscriber this broadcast reaches.
    const size = budget ? budget.sizeOf(value) : 0;
    const limit = budget ? budget.limit() : 0;
    for (const sub of this.subs) {
      if (!Queue.offerUnsafe(sub.queue, value)) {
        // The queue is full: this subscriber is not draining.
        this.dropUnsafe(
          sub,
          new SubscriberOverflow({ reason: "items", limit: this.maxQueue }),
        );
        continue;
      }
      if (budget === undefined) continue;
      sub.bytes += size;
      // Checked AFTER the offer, and against what is QUEUED rather than against
      // what is about to be: a subscriber that is keeping up drains each value
      // before the next arrives, so its queued total only passes the bound when
      // it is genuinely behind — or when a SINGLE value already costs more than
      // the publisher's re-sync, which is exactly the 0.7 MB agent reprint this
      // bound exists to skip. Either way the answer is the same: drop it and let
      // it re-sync, because re-syncing is now the cheaper of the two.
      if (sub.bytes > limit) {
        this.dropUnsafe(
          sub,
          new SubscriberOverflow({ reason: "bytes", limit }),
        );
      }
    }
  }

  /** Drop EVERY live subscriber, failing each stream with `invalidated` — the
   *  publisher declaring that what they hold no longer describes it, so they
   *  must re-subscribe and take a fresh reading.
   *
   *  Distinct from {@link closeUnsafe}: the fan-out stays OPEN and live, and a
   *  re-subscribe is expected immediately. kaval's caller is a real PTY resize,
   *  which reflows the shared screen mirror under every attached viewer: every
   *  byte still queued was laid out for a grid that no longer exists, and the
   *  repaint that follows is a full redraw the viewer does not need to watch
   *  arrive. */
  dropAllUnsafe(): void {
    if (this.closed) return;
    for (const sub of [...this.subs]) {
      this.dropUnsafe(
        sub,
        new SubscriberOverflow({ reason: "invalidated", limit: null }),
      );
    }
  }

  /** Close the fan-out — every live subscription ends gracefully, and every
   *  later subscription is born already-ended. */
  closeUnsafe(): void {
    if (this.closed) return;
    this.closed = true;
    for (const sub of this.subs) Queue.endUnsafe(sub.queue);
    this.subs.clear();
  }

  /** Whether this fan-out has any live subscribers — diagnostics only. */
  get subscriberCount(): number {
    return this.subs.size;
  }

  /**
   * Register a subscriber and, in the SAME synchronous step, take `read()`'s
   * reading of whatever the publisher's state is right now.
   *
   * This is the snapshot-then-deltas partition, held by construction: nothing
   * published between the two can be lost or duplicated, because there is no
   * "between". The subscription is released — dropped from the live set, its
   * stream ended — when the surrounding `Scope` closes, which for a served
   * member is the consuming fiber being interrupted.
   */
  subscribeWith<R>(
    read: () => R,
  ): Effect.Effect<Subscription<T, R>, never, Scope.Scope> {
    return Effect.flatMap(
      Queue.bounded<T, SubscriberOverflow | Cause.Done>(this.maxQueue),
      (queue) => {
        const sub: Subscriber<T> = { queue, bytes: 0 };
        const budget = this.byteBudget;
        // The budget's decrement rides the subscriber's OWN stream: each value
        // that leaves for the consumer gives its bytes back. A deliberate side
        // effect in a `map` — the alternative is an effectful `tap` on the hot
        // per-chunk path for one integer subtraction.
        const stream: Stream.Stream<T, SubscriberOverflow> =
          budget === undefined
            ? Stream.fromQueue(queue)
            : Stream.map(Stream.fromQueue(queue), (value) => {
                sub.bytes -= budget.sizeOf(value);
                return value;
              });
        return Effect.acquireRelease(
          Effect.sync((): Subscription<T, R> => {
            // A subscription taken after close is born ended, so a consumer sees
            // a clean end rather than a stream that never yields.
            if (this.closed) Queue.endUnsafe(queue);
            else this.subs.add(sub);
            return { stream, reading: read() };
          }),
          () =>
            Effect.sync(() => {
              this.subs.delete(sub);
              Queue.endUnsafe(queue);
            }),
        );
      },
    );
  }

  /** Register a subscriber with no reading to take — the plain delta feed. */
  get subscribe(): Effect.Effect<
    Stream.Stream<T, SubscriberOverflow>,
    never,
    Scope.Scope
  > {
    return Effect.map(
      this.subscribeWith(() => undefined),
      (sub) => sub.stream,
    );
  }

  /** The plain delta feed as a lazy `Stream` — subscribing is running it, and
   *  the subscription lives exactly as long as the stream does. */
  get stream(): Stream.Stream<T, SubscriberOverflow> {
    return Stream.unwrap(this.subscribe);
  }
}
