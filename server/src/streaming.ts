/**
 * Streaming helpers for async event-driven endpoints.
 *
 * Reusable for any oRPC streaming handler that bridges an EventEmitter
 * to an AsyncGenerator.
 */

import type { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Subscribe to an emitter event and yield items as an async iterable.
 *
 * Subscribes BEFORE returning so callers can capture a snapshot between
 * subscription and first yield — any events firing in that gap are queued.
 * Terminates when the AbortSignal fires.
 */
export async function* subscribeAndYield<T = string>(
  emitter: EventEmitter,
  event: string,
  signal: AbortSignal | undefined,
): AsyncGenerator<T> {
  const queue: T[] = [];
  let resolveNext: (() => void) | null = null;

  const listener = (data: T) => {
    queue.push(data);
    resolveNext?.();
  };
  emitter.on(event, listener);

  const cleanup = () => {
    emitter.off(event, listener);
    resolveNext?.();
  };
  signal?.addEventListener("abort", cleanup, { once: true });

  try {
    while (!signal?.aborted) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
      resolveNext = null;
    }
  } finally {
    cleanup();
    signal?.removeEventListener("abort", cleanup);
  }
}

const COALESCE_INTERVAL_MS = 8; // ~half a frame
const COALESCE_MAX_BYTES = 65536; // flush at 64KB regardless of timer

/**
 * Coalesce rapid string chunks into larger batches.
 *
 * Accumulates items from source, flushing when either the interval timer
 * fires or the buffered size exceeds the threshold. Reduces WebSocket
 * message count and escape-sequence boundary splits.
 */
export async function* coalesceStrings(
  source: AsyncGenerator<string>,
  signal: AbortSignal | undefined,
): AsyncGenerator<string> {
  let buffer = "";
  let bufferBytes = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveTimer: (() => void) | null = null;

  function startTimer() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      resolveTimer?.();
    }, COALESCE_INTERVAL_MS);
  }

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  try {
    // Pull from source in a non-blocking way: race between next item and timer
    const iter = source[Symbol.asyncIterator]();
    let pending = iter.next();

    while (!signal?.aborted) {
      const result = await pending;
      if (result.done) break;

      buffer += result.value;
      bufferBytes += Buffer.byteLength(result.value);
      pending = iter.next();

      // Flush immediately if over size threshold
      if (bufferBytes >= COALESCE_MAX_BYTES) {
        yield buffer;
        buffer = "";
        bufferBytes = 0;
        clearTimer();
        continue;
      }

      // Start coalescing timer; wait for either more data or timer expiry
      startTimer();
      const timerPromise = new Promise<"timer">((resolve) => {
        resolveTimer = () => resolve("timer");
      });
      const nextPromise = pending.then(() => "data" as const);

      const winner = await Promise.race([timerPromise, nextPromise]);
      if (winner === "timer") {
        // Timer fired — flush what we have
        if (buffer) {
          yield buffer;
          buffer = "";
          bufferBytes = 0;
        }
      }
      // If data won, loop continues and accumulates more
    }

    // Flush remainder
    if (buffer) yield buffer;
  } finally {
    clearTimer();
  }
}
