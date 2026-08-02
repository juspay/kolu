/**
 * The package's ONE bridge from a surface stream member back to the
 * pull-a-frame-at-a-time shape this CLI is written in.
 *
 * Every streaming member used to be `await client.surface.X.get(input, {signal})
 * → AsyncIterable<T>`; under Effect it is `client.surface.X.get(input) →
 * Stream<T>`, returned SYNCHRONOUSLY and LAZY, with no `AbortSignal` anywhere
 * (PLAN D10/#18: cancellation is fiber interruption). Two consequences this
 * module owns so no caller re-derives them:
 *
 *   - **Subscribing is pulling.** A `Stream` value registers nothing; the first
 *     `next()` is what starts the producer. Callers that must be subscribed
 *     BEFORE they cause the event they wait on therefore issue that first pull
 *     themselves (`attach`'s snapshot read, `wait`'s exit watcher) — the same
 *     laziness lesson kaval's `subscribeFrames` records.
 *   - **Unsubscribing is `return()`.** Closing the iterator interrupts the fiber
 *     running the stream, which IS the teardown production gets. So the
 *     `AbortSignal` a caller still owns (a Ctrl+C, the wait race's settle, the
 *     attach loop's detach) is wired to `return()` here rather than threaded
 *     into a call option that no longer exists.
 *
 * `return()` is deliberately NOT awaited: a producer parked upstream settles its
 * close late, and awaiting it would stall the next subscription (or a `for
 * await`'s own `break`). The close is fire-and-forget and its rejection is
 * swallowed — closing an already-failed stream can reject, and that rejection is
 * about the teardown, never about the data the caller already read.
 */

import type { Stream } from "effect";
import { Stream as EffectStream } from "effect";

/**
 * Subscribe to `stream` and expose it as an async iterable ITERATOR — usable
 * both hand-advanced (`await sub.next()`, for a first-frame guard) and in a `for
 * await`, over the SAME subscription, so a caller that inspects the opening
 * frame and then pumps the rest opens exactly one.
 *
 * When `signal` is given, its abort unsubscribes: a parked `next()` then
 * resolves `{ done: true }` (the fiber is interrupted, and an interruption is
 * not a failure), so a `for await` ends cleanly instead of throwing — callers
 * distinguish "we tore this down" from "the feed died" by reading the signal,
 * exactly as they did when it was a call option. Omit it for a one-shot read
 * that is bounded by the stream itself.
 */
export function subscribe<T>(
  stream: Stream.Stream<T, unknown>,
  signal?: AbortSignal,
): AsyncIterableIterator<T> {
  const iterator = EffectStream.toAsyncIterable(stream)[Symbol.asyncIterator]();
  const unsubscribe = (): void => {
    void Promise.resolve(iterator.return?.()).catch(() => {});
  };
  if (signal !== undefined) {
    if (signal.aborted) unsubscribe();
    else signal.addEventListener("abort", unsubscribe, { once: true });
  }
  return {
    next: () => iterator.next(),
    // Resolve immediately rather than awaiting the close (see the header): the
    // caller is leaving, and the interrupt it just issued needs no witness.
    return: async () => {
      unsubscribe();
      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}
