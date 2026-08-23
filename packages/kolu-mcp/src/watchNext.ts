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
 *
 * ## The two vocabularies one queue can carry
 *
 * What a batch CONTAINS is chosen at `watch_open`, by whether it named the
 * agent-state knobs (`states` / `heldForMs` / `nagMs`):
 *
 *   - **without them** — settle edges, as before: `asking` (blocked on a person),
 *     `finished` (turn ended AND output went quiet), `gone` (the terminal left).
 *     Each fires ONCE, on the edge.
 *   - **with them** — agent-state reports: `snapshot` (already matching when you
 *     opened — the standing truth, delivered before any change), `transition`
 *     (entered a state and held it for `heldForMs`), `nag` (STILL holding,
 *     `nagMs` later). The last one is why a supervisor stops losing terminals: a
 *     report it ignored comes back instead of vanishing.
 *
 * A subscription is fed by exactly one of the two, and the six `kind` literals
 * are disjoint, so a consumer branches on `kind` and never has to remember which
 * it opened.
 */

// `awaitWatchEvents` arrives dynamically, INSIDE the handler — same fence as
// `wait.ts`: this module is on the static tree-build path of every `kolu`
// invocation, so the watcher's mirror/socket closure may only load at call time.
import type { PadiSurfaceClient } from "@kolu/padi/dial";
import { type PadiWatchEvent, WATCH_NAME_MAX_LENGTH } from "@kolu/padi/surface";
import { waitOutcomeJson } from "@kolu/surface/wait";
import type { BespokeTool } from "@kolu/surface-mcp/tools";
import { Effect, Schema } from "effect";
import { MillisecondsSchema } from "./wait.ts";

export const WatchNextArgsSchema = Schema.Struct({
  // ANNOTATE FIRST, CHECK SECOND — the trap `wait.ts`'s `MillisecondsSchema`
  // documents and `argSchemas.test.ts` pins: annotating an ALREADY-checked schema
  // attaches the blurb to its last check, which is emitted inside an `allOf`
  // branch no MCP host reads. That is why these spell their own schema over the
  // wire's exported BOUND rather than reusing padi's checked `WatchNameSchema` /
  // `NonNegativeInt` objects — the number is shared, the annotation order is the
  // face's own requirement.
  name: Schema.String.annotate({
    description:
      "The subscription name you passed to watch_open. Reuse the SAME name across restarts — it reattaches to the existing queue.",
  }).check(Schema.isMinLength(1), Schema.isMaxLength(WATCH_NAME_MAX_LENGTH)),
  after: Schema.optionalKey(
    Schema.Number.annotate({
      description:
        "The `ackAfter` value from the last batch you actually PROCESSED — your acknowledgement. Omit on your first call, then pass back the `ackAfter` each result gives you. Until you acknowledge, those events stay queued and come again: that is what makes a reply lost in flight (a timeout, an interruption) cost a repeat rather than a lost report. Do NOT carry one across a kolu restart — padi says so and ignores it, but a fresh watch_open deserves a fresh cursor.",
    }).check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  // The SHARED milliseconds field — same annotate-then-check ordering trap
  // `wait.ts` documents and `argSchemas.test.ts` pins. Re-deriving it here would
  // have left this the one arg schema in the package doing that dance unpinned.
  timeoutMs: Schema.optionalKey(
    MillisecondsSchema(
      'Give up after this many milliseconds (result: "timeout") and return so you can do other work. Queued events are NOT lost by a timeout — the next call still gets them. Omit to wait indefinitely (the MCP host\'s own request timeout still applies).',
    ),
  ),
});
export type WatchNextArgs = typeof WatchNextArgsSchema.Type;

export const watchNextTool: BespokeTool = {
  input: WatchNextArgsSchema,
  mutates: false,
  title: "Wait for the next terminal event",
  description:
    'Block until any watched terminal needs you, then return every event that accumulated — the standing-subscription drain. Each event says which terminal and why. A subscription opened WITHOUT the agent-state knobs reports edges: "asking" (its agent is blocked on input), "finished" (its turn ended AND its output went quiet), or "gone" (the terminal no longer exists — stop waiting on it). A subscription opened WITH them (watch_open\'s states/heldForMs/nagMs) reports levels instead: "snapshot" (already in that state when you opened — the standing truth, handed over before any change), "transition" (entered it and held it for heldForMs), and "nag" (STILL in it, nagMs later). Prefer the second form for supervision — pass states:["awaiting","waiting"], heldForMs:60000, nagMs:300000 and a terminal you ignore comes BACK every five minutes instead of being reported once and lost. A subscription answers ONE of the two questions, never both, so the second form reports no "gone": it is a LEVEL, so a terminal that disappears simply stops being reported and nothing is left waiting on it — if you specifically need to hear about a terminal dying, keep a second subscription without the three params, or read the terminals resource. Re-opening a name with DIFFERENT params starts its queue over (the buffered events answer the question you just stopped asking, and the fresh snapshot replaces them); re-opening with the SAME params — the ordinary restart — keeps it. Events that land while you are NOT calling this are buffered, so nothing is missed between calls, and the queue survives a restart of this MCP server or of kaval. Prefer this over looping wait_agentState per terminal. Pass each result\'s `ackAfter` back as the next call\'s `after` to acknowledge it; unacknowledged events are handed over again, so a reply you never received is never lost. Returns {result: "met", met: {events, dropped, ackAfter, elapsedMs}} or {result: "timeout"|"closed", elapsedMs?, error?}. Neither non-met result means anything died: "timeout" means nothing happened in your window and "closed" means the notification channel dropped — in BOTH cases your queued events are intact, so just call again. If the subscription does not exist the call FAILS naming it (open it again with watch_open) — that is never reported as "closed". A nonzero `dropped` means the queue overflowed while you were away — re-read the terminals resource to reconcile.',
  // Lifted, not composed — `awaitWatchEvents` is a Promise-shaped waiter taking
  // an AbortSignal, the same reason the `wait_*` tools lift rather than compose.
  handler: (args, client, signal) =>
    Effect.tryPromise(async () => {
      const { name, after, timeoutMs } = args as WatchNextArgs;
      const { awaitWatchEvents } = await import("@kolu/padi/dial");
      const outcome = await awaitWatchEvents(client as PadiSurfaceClient, {
        name,
        after,
        timeoutMs,
        signal,
      });
      // The subscription NAME rides the envelope's id slot — the wait vocabulary's
      // "what was this wait about", which for a standing subscription is the name
      // rather than a terminal id.
      return waitOutcomeJson<{
        events: readonly PadiWatchEvent[];
        dropped: number;
        ackAfter: number;
        elapsedMs: number;
      }>(name, outcome, (met) => ({ met }));
    }),
};
