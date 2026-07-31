/**
 * The LIVE backing for padiSurface's `activity` stream — "which terminals are
 * moving bytes RIGHT NOW" (the `padi-tui watch`/`status` live dots).
 *
 * Activity is now owned by KAVAL (the one process that sees every PTY byte AND every
 * resize), which publishes a host-global, resize-excluded meaningful-output edge.
 * This module is just a CONSUMER of that edge — folded through the shared
 * `createActivityTracker` (its short live-dot window) into a live SET the stream
 * publishes whole (snapshot-then-deltas). No byte taps, no per-terminal
 * subscriptions, no resize-mute hack: kaval already excluded the reveal/resize
 * repaint, so a switch to an idle terminal no longer flashes its dot.
 */

import { pollOnEvent } from "@kolu/surface/server";
import {
  TERMINAL_IDLE_AFTER_MS,
  type TerminalId,
} from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import { ptyHostClient } from "../ptyHost/index.ts";
import {
  ACTIVITY_RESUBSCRIBE_DELAY_MS,
  resubscribeStream,
} from "../terminalEndpoint/local.ts";
import {
  createActivityTracker,
  sameActivitySet,
} from "./terminalActivityTracker.ts";

/** The `activity` stream backing shape — the live-set `source` thunk padi's
 *  `padiSurface` activity stream is wired with. Re-invoked per subscription
 *  (`(input, signal) => AsyncIterable<TerminalId[]>`), so each subscriber gets its
 *  own tracker fed by its own kaval subscription. */
type ActivityStreamDeps = {
  source: (
    input: Record<string, never>,
    signal: AbortSignal | undefined,
  ) => AsyncIterable<TerminalId[]>;
};

/**
 * Build the LIVE `activity` source. The `source` thunk is re-invoked PER SUBSCRIPTION,
 * so each subscriber gets its own tracker + kaval subscription, torn down on its own
 * abort. Within a subscription:
 *   - subscribe to kaval's host-global `activity` edge (re-subscribing across a kaval
 *     recycle for the watch's lifetime);
 *   - on each edge, `noteOutput(id)` into the short-window tracker;
 *   - publish the tracker's sorted live set as the stream frame (`pollOnEvent`).
 */
export function createLiveActivitySource(log: Logger): ActivityStreamDeps {
  return {
    // An async generator so teardown rides its `finally` — it fires whether the
    // subscription ends by the framework's abort OR by the consumer stopping
    // iteration (the stream `signal` is `AbortSignal | undefined`, so tying teardown
    // to it alone would leak when no signal is passed). A LOCAL abort, chained from
    // the framework signal, ends the kaval subscription.
    source: (_input, signal) =>
      (async function* activityFrames(): AsyncGenerator<TerminalId[]> {
        const localAbort = new AbortController();
        if (signal !== undefined) {
          if (signal.aborted) localAbort.abort();
          else
            signal.addEventListener("abort", () => localAbort.abort(), {
              once: true,
            });
        }
        const sig = localAbort.signal;
        const tracker = createActivityTracker(TERMINAL_IDLE_AFTER_MS);

        // Feed the tracker from kaval's meaningful-output edge — the resize-excluded
        // activity fact, shared with the finish fold. `resubscribeStream` owns the
        // re-subscribe loop across a kaval recycle (so a long watch survives a daemon
        // restart) AND the guard against the forwarding facade's EAGER synchronous
        // throw when the daemon is down — see its doc. `onStreamError` is omitted
        // (mirroring `inventoryReconcile`'s identical call) so an established
        // subscription that breaks mid-stream keeps `bridgeStream`'s default ERROR
        // log — a genuine connection failure, not a merely-expected-absent condition,
        // so it must stay visible to error-level alerting (`errors-must-log-at-error`).
        void resubscribeStream({
          signal: sig,
          delayMs: ACTIVITY_RESUBSCRIBE_DELAY_MS,
          getStream: () =>
            ptyHostClient.surface.activity.get({}, { signal: sig }),
          onEvent: (edge) => tracker.noteOutput(edge.id as TerminalId),
          onDrop: (err) =>
            log.debug(
              { err },
              "kaval activity subscribe failed; will re-subscribe",
            ),
        });

        try {
          yield* pollOnEvent<TerminalId[]>({
            read: async () => tracker.snapshot(),
            isEqual: sameActivitySet,
            install: (onEvent) => tracker.onChange(onEvent),
            signal: sig,
            onReadError: () => {},
          });
        } finally {
          localAbort.abort();
          tracker.dispose();
        }
      })(),
  };
}
