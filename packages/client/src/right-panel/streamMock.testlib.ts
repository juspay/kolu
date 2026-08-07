/** Shared hand-driven `Stream` mock for `unenrolledStreamCall`, for the pulse-driven
 *  Code-tab query tests. It emits one frame per pushed `{ frame: true }`, FAILS on a
 *  pushed `{ err }`, and runs `onTeardown` when its subscription ends — the identical
 *  mechanics `createPolledQuery.test.ts` and `hostCodeTab.test.ts` each used to
 *  hand-roll. Each test wires its OWN emit tracking (a single `latest`, or a
 *  multi-subscriber Set) on top of the returned `push`, since that part genuinely
 *  differs per fixture.
 *
 *  It is a `Stream`, not an abort-aware async iterable: a member ref returns a lazy
 *  `Stream` now, and teardown is a fiber INTERRUPT rather than an `AbortSignal`
 *  (D10/#18). So "the superseded pulse stopped" is observed through the stream's own
 *  finalizer — which is what actually closes a wire subscription in production — and
 *  `onTeardown` is the seam a fixture hangs its bookkeeping on.
 *
 *  Pushes made BEFORE the stream is run are buffered and replayed on subscribe, so a
 *  fixture never has to know when the consumer's fiber got scheduled. */

import { Cause, Effect, Queue, Stream } from "effect";

export type StreamEvent = { frame: true } | { err: Error };

export function makeControllableStream(opts?: { onTeardown?: () => void }): {
  stream: Stream.Stream<undefined, Error>;
  push: (event: StreamEvent) => void;
} {
  let sink: ((event: StreamEvent) => void) | null = null;
  const buffered: StreamEvent[] = [];
  const push = (event: StreamEvent): void => {
    if (sink) sink(event);
    else buffered.push(event);
  };
  const stream = Stream.callback<undefined, Error>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        sink = (event) => {
          if ("err" in event) {
            Queue.failCauseUnsafe(queue, Cause.fail(event.err));
          } else {
            Queue.offerUnsafe(queue, undefined);
          }
        };
        for (const event of buffered.splice(0)) sink(event);
      }),
      () =>
        Effect.sync(() => {
          sink = null;
          opts?.onTeardown?.();
        }),
    ),
  );
  return { stream, push };
}
