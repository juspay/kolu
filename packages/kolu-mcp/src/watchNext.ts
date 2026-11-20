import {
  NonNegativeInt,
  type PadiWatchEvent,
  WatchNameSchema,
} from "@kolu/padi-client/surface";
import { padiOf } from "./bundleClient.ts";
import { waitOutcomeJson } from "@kolu/surface/wait";
import type { BespokeTool } from "@kolu/surface-mcp/tools";
import { Effect, Schema } from "effect";
import { MillisecondsSchema } from "./wait.ts";

export const WatchNextArgsSchema = Schema.Struct({
  name: WatchNameSchema.annotate({
    description:
      "The subscription name you passed to watch_open. Reuse the SAME name across restarts — it reattaches to the existing queue.",
  }),
  after: Schema.optionalKey(
    NonNegativeInt.annotate({
      description:
        "The `ackAfter` value from the last batch you actually PROCESSED — your acknowledgement. Omit on your first call, then pass back the `ackAfter` each result gives you. Until you acknowledge, those events stay queued and come again: that is what makes a reply lost in flight (a timeout, an interruption) cost a repeat rather than a lost report. Do NOT carry one across a kolu restart — padi says so and ignores it, but a fresh watch_open deserves a fresh cursor.",
    }),
  ),
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
  handler: (args, client, signal) =>
    Effect.tryPromise(async (fiberSignal) => {
      const { name, after, timeoutMs } = args as WatchNextArgs;
      const { awaitWatchEvents } = await import("@kolu/padi-client/watch");
      const outcome = await awaitWatchEvents(padiOf(client), {
        name,
        after,
        timeoutMs,
        signal: signal ?? fiberSignal,
      });
      return waitOutcomeJson<{
        events: readonly PadiWatchEvent[];
        dropped: number;
        ackAfter: number;
        elapsedMs: number;
      }>(name, outcome, (met) => ({ met }));
    }),
};
