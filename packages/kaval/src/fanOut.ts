import { Cause, Data, Effect, Queue, type Scope, Stream } from "effect";

const DEFAULT_MAX_QUEUE = 10_000;

/** Which bound a subscriber exceeded — it was not draining fast enough, in
 *  items or in bytes. */
export type SubscriberDropReason = "items" | "bytes";

/** THIS subscriber lagged past a bound and was dropped. Carried on its own
 *  stream's error channel — siblings are unaffected — so the serving layer
 *  turns it into a typed `overflow` frame and the consumer re-attaches for a
 *  fresh snapshot rather than reading the end as a PTY exit. */
export class SubscriberOverflow extends Data.TaggedError("SubscriberOverflow")<{
  readonly reason: SubscriberDropReason;
  /** The bound that was exceeded, in `reason`'s own unit — items or bytes. */
  readonly limit: number;
}> {}

/** The publisher declared every subscriber's buffered view worthless and
 *  dropped them all: nothing was exceeded, and a re-subscribe for a fresh
 *  reading is expected immediately. */
export class SubscriberInvalidated extends Data.TaggedError(
  "SubscriberInvalidated",
)<Record<never, never>> {}

/** Why a subscription's stream failed: a bound this subscriber crossed, or a
 *  publisher-wide invalidation. */
export type SubscriberDropped = SubscriberOverflow | SubscriberInvalidated;

/** A per-subscriber BYTE bound, measured by the publisher. */
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
   *  {@link SubscriberDropped} if this subscriber lagged past a bound or the
   *  publisher invalidated it. */
  readonly stream: Stream.Stream<T, SubscriberDropped>;
  /** What `read()` returned, at the instant of registration. */
  readonly reading: R;
}

interface Subscriber<T> {
  readonly queue: Queue.Queue<T, SubscriberDropped | Cause.Done>;
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
   *  so a later publish can never reach it; draining before the fail is what
   *  makes the failure immediate (a queue failed with messages still in it
   *  stays `Closing` until they are taken). */
  private dropUnsafe(sub: Subscriber<T>, err: SubscriberDropped): void {
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
    const size = budget ? budget.sizeOf(value) : 0;
    const limit = budget ? budget.limit() : 0;
    for (const sub of this.subs) {
      if (!Queue.offerUnsafe(sub.queue, value)) {
        this.dropUnsafe(
          sub,
          new SubscriberOverflow({ reason: "items", limit: this.maxQueue }),
        );
        continue;
      }
      if (budget === undefined) continue;
      sub.bytes += size;
      if (sub.bytes > limit) {
        this.dropUnsafe(
          sub,
          new SubscriberOverflow({ reason: "bytes", limit }),
        );
      }
    }
  }

  /** Drop EVERY live subscriber, failing each stream with
   *  {@link SubscriberInvalidated} — the publisher declaring that what they
   *  hold no longer describes it, so they must re-subscribe and take a fresh
   *  reading. Distinct from {@link closeUnsafe}: the fan-out stays OPEN and
   *  live, and a re-subscribe is expected immediately. */
  dropAllUnsafe(): void {
    if (this.closed) return;
    for (const sub of [...this.subs]) {
      this.dropUnsafe(sub, new SubscriberInvalidated());
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
      Queue.bounded<T, SubscriberDropped | Cause.Done>(this.maxQueue),
      (queue) => {
        const sub: Subscriber<T> = { queue, bytes: 0 };
        const budget = this.byteBudget;
        const stream: Stream.Stream<T, SubscriberDropped> =
          budget === undefined
            ? Stream.fromQueue(queue)
            : Stream.map(Stream.fromQueue(queue), (value) => {
                sub.bytes -= budget.sizeOf(value);
                return value;
              });
        return Effect.acquireRelease(
          Effect.sync((): Subscription<T, R> => {
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
    Stream.Stream<T, SubscriberDropped>,
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
  get stream(): Stream.Stream<T, SubscriberDropped> {
    return Stream.unwrap(this.subscribe);
  }
}
