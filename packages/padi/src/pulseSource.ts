import { pollOnEvent, streamFromAbortableSource } from "@kolu/surface/server";
import type { Stream } from "effect";
import type { Logger } from "pino";

/** A monotonic per-subscription pulse source over a callback watcher. Yields
 *  `{seq:0}` at subscribe (the snapshot frame), then a fresh incrementing `seq`
 *  on every change — the distinct value is what defeats the stream's dedup, and
 *  the counter is minted per subscription, never shared. */
export function pulseSource(
  install: (onEvent: () => void) => () => void,
  log: Logger,
  label: string,
): Stream.Stream<{ readonly seq: number }> {
  return streamFromAbortableSource<{ readonly seq: number }>((signal) => {
    let seq = 0;
    return pollOnEvent<{ readonly seq: number }>({
      read: () => Promise.resolve({ seq: seq++ }),
      isEqual: (a, b) => a.seq === b.seq,
      install,
      signal,
      onReadError: (err) =>
        log.error({ err }, `padi: ${label} pulse read failed`),
    });
  });
}
