/**
 * The agent-state watch as a `Stream` — the `watchStates` member's backing.
 *
 * The hub is push-shaped (it calls a subscriber when something comes due) and a
 * surface stream is pull-shaped, so this is the one adapter between them. It is
 * `Stream.callback` and nothing else: effect's own bridge already IS a queue
 * that buffers what a slow consumer has not pulled yet (an unbounded one, so a
 * nag is never dropped on the floor), and a scoped `acquireRelease` whose
 * finalizer runs when the consuming fiber is interrupted — which is the whole of
 * "fiber interruption is the unsubscribe" (D10/#18), with no signal to thread
 * and no generator to resume.
 *
 * The sibling bridge, `streamFromAbortableSource`, is for an ABORTSIGNAL-shaped
 * producer (a PTY tap, an fs watcher). This producer hands back an
 * `unsubscribe`, so it is already scope-shaped and reaching for the signal
 * bridge only bought a hand-rolled queue-and-wake in front of the same idea.
 *
 * Snapshot-then-deltas comes free and is not incidental — `hub.subscribe` emits
 * the currently-matching set synchronously, so it is this stream's FIRST frame,
 * which is exactly what the framework's retry fence needs: a transparently
 * re-subscribed stream re-leads with a fresh snapshot instead of resuming
 * mid-history.
 */

import type { PadiStateEvent } from "@kolu/padi-client/surface";
import { Effect, Queue, Stream } from "effect";
import type { Logger } from "pino";
import type { StateWatchHub, StateWatchSpec } from "./stateWatch.ts";

export function stateWatchSource(
  hub: StateWatchHub,
  spec: StateWatchSpec,
  log: Logger,
): Stream.Stream<readonly PadiStateEvent[]> {
  return Stream.callback<readonly PadiStateEvent[]>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        hub.subscribe(spec, (batch) => {
          Queue.offerUnsafe(queue, batch);
        }),
      ),
      (sub) =>
        Effect.sync(() => {
          sub.stop();
          log.debug("padi: watchStates subscription ended");
        }),
    ),
  );
}
