/**
 * Bounded, eager-subscribe fan-out — the primitive a `PtyHost` uses to hand one
 * PTY's output (and its OSC-derived metadata) to many independent consumers.
 *
 * Three properties earn this its own type rather than Effect's own `PubSub`:
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
 *   3. **The drop IS the stream's error.** A dropped subscriber's stream fails
 *      with {@link SubscriberOverflow} instead of ending, so a consumer cannot
 *      confuse "you lagged, re-attach" with "the PTY exited". It used to be an
 *      out-of-band `onOverflow` callback flipping a mutable flag the serving
 *      layer read after the loop; now it is the error channel, and "overflow is
 *      the last frame" holds by type.
 */

import { Cause, Data, Effect, Queue, type Scope, Stream } from "effect";

/** Default per-subscriber buffered-item cap before drop-slow kicks in. */
const DEFAULT_MAX_QUEUE = 10_000;

/** THIS subscriber lagged past its bound and was dropped. Carried on its own
 *  stream's error channel — siblings are unaffected — so the serving layer turns
 *  it into a typed `overflow` frame and the consumer re-attaches for a fresh
 *  snapshot rather than reading the end as a PTY exit. */
export class SubscriberOverflow extends Data.TaggedError("SubscriberOverflow")<{
  readonly maxQueue: number;
}> {}

export interface FanOutOptions {
  /** Per-subscriber buffered-item cap. A subscriber that cannot take a value
   *  because its queue is full is dropped (its stream fails with
   *  {@link SubscriberOverflow}) rather than buffering forever. Defaults to
   *  10,000. */
  maxQueue?: number;
}

/** A live subscription: the stream of values published after it was registered,
 *  plus the caller's reading of publisher state taken in the SAME synchronous
 *  step. See {@link FanOut.subscribeWith}. */
export interface Subscription<T, R> {
  /** Values published AFTER this subscription was registered. Ends when the
   *  fan-out closes or the subscription's scope does; fails with
   *  {@link SubscriberOverflow} if this subscriber lagged past the bound. */
  readonly stream: Stream.Stream<T, SubscriberOverflow>;
  /** What `read()` returned, at the instant of registration. */
  readonly reading: R;
}

/** One publisher, many independently-bounded subscribers. */
export class FanOut<T> {
  /** Every live subscriber's queue. `Cause.Done` rides in the error type
   *  because ending a queue IS a `Done` failure; `Stream.fromQueue` excludes it
   *  again, so a subscriber sees only {@link SubscriberOverflow}. */
  private readonly subs = new Set<
    Queue.Queue<T, SubscriberOverflow | Cause.Done>
  >();
  private closed = false;
  private readonly maxQueue: number;

  constructor(options: FanOutOptions = {}) {
    this.maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
  }

  /** Synchronous fire-and-forget broadcast to every live subscriber — called
   *  straight from node-pty / xterm callbacks, which is why it is `Unsafe`
   *  (outside Effect) rather than an `Effect`. */
  publishUnsafe(value: T): void {
    if (this.closed) return;
    for (const queue of this.subs) {
      if (Queue.offerUnsafe(queue, value)) continue;
      // The queue is full: this subscriber is not draining. Drop it — remove it
      // from the live set first, so a later publish can never reach it, then
      // DISCARD whatever it had buffered and fail its stream. Discarding is
      // deliberate: a dropped consumer re-attaches and gets a fresh snapshot, so
      // replaying the stale bytes it never read is pointless. (Draining before
      // the fail is what makes the failure immediate: a queue failed with
      // messages still in it stays `Closing` until they are taken.)
      this.subs.delete(queue);
      while (Queue.sizeUnsafe(queue) > 0) Queue.takeUnsafe(queue);
      Queue.failCauseUnsafe(
        queue,
        Cause.fail(new SubscriberOverflow({ maxQueue: this.maxQueue })),
      );
    }
  }

  /** Close the fan-out — every live subscription ends gracefully, and every
   *  later subscription is born already-ended. */
  closeUnsafe(): void {
    if (this.closed) return;
    this.closed = true;
    for (const queue of this.subs) Queue.endUnsafe(queue);
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
      (queue) =>
        Effect.acquireRelease(
          Effect.sync((): Subscription<T, R> => {
            // A subscription taken after close is born ended, so a consumer sees
            // a clean end rather than a stream that never yields.
            if (this.closed) Queue.endUnsafe(queue);
            else this.subs.add(queue);
            return { stream: Stream.fromQueue(queue), reading: read() };
          }),
          () =>
            Effect.sync(() => {
              this.subs.delete(queue);
              Queue.endUnsafe(queue);
            }),
        ),
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
