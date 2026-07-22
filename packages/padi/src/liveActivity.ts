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
import { ptyHostClient } from "./ptyHost/index.ts";
import {
  createActivityTracker,
  sameActivitySet,
} from "./terminalActivityTracker.ts";
import { bridgeStream } from "./terminalEndpoint/local.ts";

/** Delay before re-subscribing to kaval's `activity` stream after it ends (a daemon
 *  recycle) — long enough not to hot-loop while kaval is down, short enough that the
 *  live dots resume promptly. */
const ACTIVITY_RESUBSCRIBE_DELAY_MS = 2_000;

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
        // activity fact, shared with the finish fold. Re-subscribe across a kaval
        // recycle so a long watch survives a daemon restart.
        void (async () => {
          while (!sig.aborted) {
            try {
              await bridgeStream(
                ptyHostClient.surface.activity.get({}, { signal: sig }),
                sig,
                (edge) => tracker.noteOutput(edge.id as TerminalId),
              );
            } catch (err) {
              if (sig.aborted) return;
              log.debug(
                { err },
                "kaval activity subscribe failed; will re-subscribe",
              );
            }
            if (sig.aborted) return;
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, ACTIVITY_RESUBSCRIBE_DELAY_MS);
              t.unref?.();
              sig.addEventListener("abort", () => {
                clearTimeout(t);
                resolve();
              });
            });
          }
        })();

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
