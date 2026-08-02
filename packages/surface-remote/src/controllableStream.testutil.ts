/**
 * A hand-driven `Stream` for unit tests: the test pushes frames, and can end it
 * cleanly (`end`) or kill it with a failure (`fail`, i.e. a mid-chain link death).
 *
 * Shared by `relayStream.test` and `reServeSurface.test` so BOTH exercise the same
 * teardown semantics. Not a test file (no `.test.ts`), so vitest doesn't collect
 * it; it's imported by the tests.
 *
 * **Why a `Queue`, not an async generator.** The obvious port —
 * `Stream.fromAsyncIterable` over the old generator — is a teardown DEADLOCK:
 * `fromAsyncIterable` installs an `Effect.promise(() => iter.return())` finalizer
 * and AWAITS it, while an async generator parked at `await` defers its `.return()`
 * until that await settles — and this generator's await is only settled by a push
 * that will never come once the consumer is gone. (S2 measured exactly this shape
 * hanging `Fiber.interrupt` forever.) A queue has no such coupling: interrupting
 * the consumer simply stops taking.
 *
 * The old `stream(signal)` is gone with the `AbortSignal` it took (PLAN D10):
 * cancellation is fiber INTERRUPTION now, so there is no signal to observe and the
 * "rejects a pending pull with `signal.reason`" contract has no counterpart — an
 * interrupted consumer is not a failure the producer reports.
 */

import { Cause, Effect, Queue, Stream } from "effect";

export interface Controllable<T> {
  /** A single-consumer `Stream` that yields pushed frames and terminates on
   *  `end` (clean) / `fail` (a failure). Frames pushed BEFORE it is subscribed
   *  are buffered and replayed on subscribe, so a test can seed a snapshot
   *  without racing the subscription. */
  readonly stream: Stream.Stream<T, unknown>;
  push(v: T): void;
  end(): void;
  fail(err: unknown): void;
}

export function controllable<T>(): Controllable<T> {
  type Q = Queue.Queue<T, unknown | Cause.Done>;
  let queue: Q | null = null;
  const buffered: Array<(q: Q) => void> = [];
  const apply = (op: (q: Q) => void): void => {
    if (queue !== null) op(queue);
    else buffered.push(op);
  };
  const stream = Stream.callback<T, unknown>((q) =>
    Effect.sync(() => {
      queue = q as Q;
      for (const op of buffered.splice(0)) op(q as Q);
    }),
  );
  return {
    stream,
    push(v) {
      apply((q) => {
        Queue.offerUnsafe(q, v);
      });
    },
    end() {
      apply((q) => {
        Queue.endUnsafe(q);
      });
    },
    fail(err) {
      apply((q) => {
        Queue.failCauseUnsafe(q, Cause.fail(err));
      });
    },
  };
}
