/**
 * The agent-state watch as a `Stream` — the `watchStates` member's backing.
 *
 * The hub is push-shaped (it calls a subscriber when something comes due) and a
 * surface stream is pull-shaped, so this is the one adapter between them. Same
 * bridge every other padi producer uses (`streamFromAbortableSource`), for the
 * same reason: interrupting the consuming fiber must unsubscribe, and fiber
 * interruption is the only cancellation there is (D10/#18).
 *
 * Snapshot-then-deltas comes free and is not incidental — `hub.subscribe` emits
 * the currently-matching set synchronously, so it is this stream's FIRST frame,
 * which is exactly what the framework's retry fence needs: a transparently
 * re-subscribed stream re-leads with a fresh snapshot instead of resuming
 * mid-history.
 */

import { streamFromAbortableSource } from "@kolu/surface/server";
import type { Stream } from "effect";
import type { Logger } from "pino";
import type { PadiStateEvent } from "../surface.ts";
import type {
  StateWatchBatch,
  StateWatchHub,
  StateWatchSpec,
} from "./stateWatch.ts";

export function stateWatchSource(
  hub: StateWatchHub,
  spec: StateWatchSpec,
  log: Logger,
): Stream.Stream<readonly PadiStateEvent[]> {
  return streamFromAbortableSource<readonly PadiStateEvent[]>((signal) =>
    (async function* frames(): AsyncGenerator<readonly PadiStateEvent[]> {
      // Batches the hub has handed over but the consumer has not pulled yet. The
      // hub emits on a timer and on the terminals cadence; a consumer reading a
      // slow pipe must not lose a nag because it was mid-write, so the frames
      // queue rather than being dropped.
      const pending: StateWatchBatch[] = [];
      let wake: (() => void) | undefined;
      const nudge = (): void => {
        const w = wake;
        wake = undefined;
        w?.();
      };
      const unsubscribe = hub.subscribe(spec, (batch) => {
        pending.push(batch);
        nudge();
      });
      signal.addEventListener("abort", nudge, { once: true });
      try {
        while (true) {
          while (pending.length > 0) {
            const batch = pending.shift();
            // `pending.length > 0` guarantees this, but the compiler does not
            // know it; an early return here would silently end a live feed.
            if (batch === undefined) break;
            yield batch;
          }
          if (signal.aborted) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
            // The abort may have landed between the drain above and this
            // registration, in which case nothing will nudge us again.
            if (signal.aborted) nudge();
          });
        }
      } finally {
        signal.removeEventListener("abort", nudge);
        unsubscribe();
        log.debug("padi: watchStates subscription ended");
      }
    })(),
  );
}
