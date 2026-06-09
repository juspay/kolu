/**
 * A per-node log tail: a clamped in-memory buffer plus a delta channel, with
 * lazy creation keyed by node id. One domain concept (`nodeLog`'s server side)
 * that both the runner and the coordinator need — the runner serves it raw, the
 * coordinator composes it with a per-SHA file sink for durability.
 *
 *   - `append(id, text)` — clamp `buffer + text`, publish an `append` frame.
 *   - `reset(id, text)`  — clamp `text` to the buffer, publish a `snapshot`.
 *   - `streamSource`     — the `nodeLog` source: yield the buffered snapshot,
 *                          then forward every later frame off the bus.
 */

import { type Channel, inMemoryChannel } from "@kolu/surface/server";
import { clampLog, type NodeLogMessage } from "./surface";

export interface LogTail {
  /** The in-memory entry for a node — its tail buffer and its delta channel —
   *  created lazily on first touch. */
  buffer: string;
  bus: Channel<NodeLogMessage>;
}

export interface CreateLogTailResult {
  /** Lazily-created tail entry for a node. */
  logFor: (id: string) => LogTail;
  /** Clamp `buffer + text` and publish an `append` frame. */
  append: (id: string, text: string) => void;
  /** Clamp `text` as the new buffer and publish a `snapshot` frame. */
  reset: (id: string, text: string) => void;
  /** `nodeLog` stream source: snapshot then live deltas for one node. */
  streamSource: (
    input: { id: string },
    signal: AbortSignal | undefined,
  ) => AsyncGenerator<NodeLogMessage>;
}

export function createLogTail(): CreateLogTailResult {
  const logs = new Map<string, LogTail>();
  const logFor = (id: string): LogTail => {
    let log = logs.get(id);
    if (log === undefined) {
      log = { buffer: "", bus: inMemoryChannel<NodeLogMessage>() };
      logs.set(id, log);
    }
    return log;
  };

  const append = (id: string, text: string): void => {
    const log = logFor(id);
    log.buffer = clampLog(log.buffer + text);
    log.bus.publish({ kind: "append", text });
  };
  const reset = (id: string, text: string): void => {
    const log = logFor(id);
    log.buffer = clampLog(text);
    log.bus.publish({ kind: "snapshot", text: log.buffer });
  };

  async function* streamSource(
    { id }: { id: string },
    signal: AbortSignal | undefined,
  ): AsyncGenerator<NodeLogMessage> {
    const log = logFor(id);
    yield { kind: "snapshot", text: log.buffer } satisfies NodeLogMessage;
    for await (const msg of log.bus.subscribe(signal)) yield msg;
  }

  return { logFor, append, reset, streamSource };
}
