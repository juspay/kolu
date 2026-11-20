import { Cause, Effect, Queue, Stream } from "effect";

export type StreamEvent = { frame: true } | { err: Error };

export function makeReplayingControllableStream(opts?: {
  onTeardown?: () => void;
}): {
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
