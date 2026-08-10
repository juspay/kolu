/**
 * `watch_next` — the standing-subscription drain, and the tool that retires the
 * watcher choreography.
 *
 * The `wait_*` tools watch ONE terminal for ONE condition, and only while the
 * call is open. A supervisor of several workers therefore had to hand-roll a
 * subscription layer on top: background watchers looping the waits and reporting
 * back. That layer drops reports at every seam — a watcher that returns leaves
 * its lane unwatched until someone remembers to re-arm it, and everything a
 * supervisor's own restart was holding dies with it.
 *
 * This is the shape that has none of those seams: `watch_open` once, then
 * `watch_next` in a loop. Events accumulate in padi — which outlives both this
 * MCP process and kaval — so the time between two calls is not a blind spot, and
 * re-opening the same NAME after any restart reattaches to the queue rather than
 * starting an empty one.
 *
 * Bespoke rather than a plain expose of `watch.drain` for one reason: the raw
 * verb never blocks (deliberately — no handler is held open server-side), so an
 * agent given only that verb would poll. This lifts padi's `awaitWatchEvents`,
 * which parks on the pulse stream and drains when it rings.
 */

import { awaitWatchEvents, type PadiSurfaceClient } from "@kolu/padi/dial";
import type { PadiSettleEvent } from "@kolu/padi/surface";
import { MAX_TIMER_MS, waitOutcomeJson } from "@kolu/surface/wait";
import type { BespokeTool } from "@kolu/surface-mcp";
import { Effect, Schema } from "effect";

export const WatchNextArgsSchema = Schema.Struct({
  name: Schema.String.annotate({
    description:
      "The subscription name you passed to watch_open. Reuse the SAME name across restarts — it reattaches to the existing queue.",
  }).check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  timeoutMs: Schema.optionalKey(
    Schema.Number.annotate({
      description:
        'Give up after this many milliseconds (result: "timeout") and return so you can do other work. Buffered events are NOT lost by a timeout — the next call still gets them. Omit to wait indefinitely (the MCP host\'s own request timeout still applies).',
    }).check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(MAX_TIMER_MS),
    ),
  ),
});
export type WatchNextArgs = typeof WatchNextArgsSchema.Type;

export const watchNextTool: BespokeTool = {
  input: WatchNextArgsSchema,
  mutates: false,
  description:
    'Block until any watched terminal needs you, then return every settle event that accumulated — the standing-subscription drain. Each event says which terminal and why: "asking" (its agent is blocked on input) or "finished" (its turn ended AND its output went quiet). Events that land while you are NOT calling this are buffered, so nothing is missed between calls, and the queue survives a restart of this MCP server or of kaval. Prefer this over looping wait_agentState per terminal. Returns {result: "met", met: {events, dropped, cursor, elapsedMs}} or {result: "timeout"|"closed", elapsedMs?, error?}. A nonzero `dropped` means the buffer overflowed while you were away — re-read the terminals resource to reconcile.',
  // Lifted, not composed — `awaitWatchEvents` is a Promise-shaped waiter taking
  // an AbortSignal, the same reason the `wait_*` tools lift rather than compose.
  handler: (args, client, signal) =>
    Effect.tryPromise(async () => {
      const { name, timeoutMs } = args as WatchNextArgs;
      const outcome = await awaitWatchEvents(client as PadiSurfaceClient, {
        name,
        timeoutMs,
        signal,
      });
      // The subscription NAME rides the envelope's id slot — the wait vocabulary's
      // "what was this wait about", which for a standing subscription is the name
      // rather than a terminal id.
      return waitOutcomeJson<{
        events: readonly PadiSettleEvent[];
        dropped: number;
        cursor: number;
        elapsedMs: number;
      }>(name, outcome, (met) => ({ met }));
    }),
};
