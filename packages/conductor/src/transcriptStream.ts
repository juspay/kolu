/**
 * The conductor's transcript as a `Stream` — the `conductorTranscript`
 * member's backing.
 *
 * The host is push-shaped (it calls every sink when the conversation moves) and
 * a surface stream is pull-shaped, so this is the one adapter between them. It
 * is `Stream.callback` and nothing else, for the reason `stateWatchSource`
 * gives: effect's own bridge IS a queue that buffers what a slow consumer has
 * not pulled yet, and its scoped `acquireRelease` finalizer runs when the
 * consuming fiber is interrupted — which is the whole of "fiber interruption is
 * the unsubscribe", with no signal to thread.
 *
 * SNAPSHOT-THEN-DELTAS is not incidental here either: `watch` calls its sink
 * with the snapshot SYNCHRONOUSLY, inside the acquire, so the snapshot is
 * queued before any delta can be. That is exactly what the framework's retry
 * fence needs — a transparently re-subscribed stream re-leads with a fresh
 * snapshot the consumer ASSIGNS over its accumulator, rather than resuming
 * mid-history into a map that already holds those rows.
 */

import type { ConductorFrame } from "kolu-common/conductor";
import { Effect, Queue, Stream } from "effect";
import type { Logger } from "pino";
import type { ConductorHost } from "./conductor.ts";

export function conductorTranscriptSource(
  host: ConductorHost,
  log: Logger,
): Stream.Stream<ConductorFrame> {
  return Stream.callback<ConductorFrame>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        host.watch((frame) => {
          Queue.offerUnsafe(queue, frame);
        }),
      ),
      (unwatch) =>
        Effect.sync(() => {
          unwatch();
          log.debug("kolu-server: conductorTranscript subscription ended");
        }),
    ),
  );
}
