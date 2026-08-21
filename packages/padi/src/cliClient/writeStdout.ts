/**
 * One live-feed line as a single flushed write of payload + trailing newline.
 *
 * NodeSink's `write()` returning true means "the buffer accepted it", not "the
 * pipe consumer can read a terminated line". A piped reader waiting on `\n`
 * then sits one event behind. The terminator is TRAILING, never leading, and
 * rides in the same write as the payload.
 */

import { Effect } from "effect";

export function terminateWatchLine(payload: string): string {
  return payload.endsWith("\n") ? payload : `${payload}\n`;
}

export function writeFlushedLine<E>(
  writable: NodeJS.WritableStream,
  payload: string,
  onError: (cause: unknown) => E,
): Effect.Effect<void, E> {
  return Effect.callback<void, E>((resume) => {
    const line = terminateWatchLine(payload);
    writable.write(line, (err) => {
      if (err != null) {
        resume(Effect.fail(onError(err)));
      } else {
        resume(Effect.void);
      }
    });
  });
}
