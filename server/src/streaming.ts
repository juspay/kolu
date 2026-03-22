/**
 * Streaming helpers for async event-driven endpoints.
 *
 * Reusable for any oRPC streaming handler that bridges an EventEmitter
 * to an AsyncGenerator.
 */

import type { EventEmitter } from "node:events";

/**
 * Subscribe to a string-valued emitter event and yield items as an async iterable.
 *
 * Subscribes BEFORE returning so callers can capture a snapshot between
 * subscription and first yield — any events firing in that gap are queued.
 * Terminates when the AbortSignal fires.
 */
export async function* subscribeAndYield(
  emitter: EventEmitter,
  event: string,
  signal: AbortSignal | undefined,
): AsyncGenerator<string> {
  const queue: string[] = [];
  let resolveNext: (() => void) | null = null;

  const listener = (data: string) => {
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
