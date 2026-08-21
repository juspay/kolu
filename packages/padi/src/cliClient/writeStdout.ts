/**
 * One live-feed line as a single write(2) of payload + trailing newline.
 *
 * `Writable.write()` (and NodeSink) returning/calling back means the userspace
 * buffer accepted the bytes, not that a piped C consumer (`head`, `grep`) can
 * read a terminated line. A file redirection looks prompt because Node already
 * uses a blocking fd write there; a direct pipe does not. `writeSync` is the
 * same path `kolu mcp` uses for a line that must be on the fd before anything
 * else happens. The terminator is TRAILING, never leading, and rides in that
 * one write.
 */

import { writeSync } from "node:fs";
import { Effect } from "effect";

export function terminateWatchLine(payload: string): string {
  return payload.endsWith("\n") ? payload : `${payload}\n`;
}

function fdOf(writable: NodeJS.WritableStream): number {
  const fd = (writable as { readonly fd?: unknown }).fd;
  if (typeof fd !== "number") {
    throw new Error(
      "watch line write needs a file descriptor (a pipe or file), not a buffered in-process stream",
    );
  }
  return fd;
}

export function writeFlushedLine<E>(
  writable: NodeJS.WritableStream,
  payload: string,
  onError: (cause: unknown) => E,
): Effect.Effect<void, E> {
  return Effect.try({
    try: () => {
      writeSync(fdOf(writable), terminateWatchLine(payload));
    },
    catch: (cause) => onError(cause),
  });
}
