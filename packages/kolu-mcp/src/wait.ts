import { refusingAsleep } from "./asleep.ts";
import { padiOf } from "./bundleClient.ts";
import { ScreenTextTailSchema } from "@kolu/padi-client/surface";
import {
  MAX_TIMER_MS,
  type WaitMet,
  type WaitOutcome,
  waitOutcomeJson,
} from "@kolu/surface/wait";
import type { BespokeTool } from "@kolu/surface-mcp/tools";
import { WAIT_STATES } from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";

export const MillisecondsSchema = (description: string) =>
  Schema.Number.annotate({ description }).check(
    Schema.isInt(),
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(MAX_TIMER_MS),
  );

const TimeoutMsSchema = Schema.optionalKey(
  MillisecondsSchema(
    'Give up after this many milliseconds (result: "timeout"). Omit to wait indefinitely (the MCP host\'s own request timeout still applies).',
  ),
);

const ScreenTailSchema = Schema.optionalKey(
  ScreenTextTailSchema.annotate({
    description:
      "Also return the terminal's last N rendered lines on the met, read INSIDE this wait — so no second screen_text call can race the terminal between the signal and the read.",
  }),
);

export function waitJson<Met extends WaitMet>(
  id: string,
  outcome: WaitOutcome<Met>,
): Record<string, unknown> {
  return waitOutcomeJson(id, outcome, (met) => ({ met }));
}

export const WaitOutputSettledArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
  idleMs: MillisecondsSchema(
    'Resolve once no output has arrived for this many milliseconds — the agent-agnostic "turn ended / awaiting input" signal (e.g. 800).',
  ),
  screenTail: ScreenTailSchema,
  timeoutMs: TimeoutMsSchema,
});
export type WaitOutputSettledArgs = typeof WaitOutputSettledArgsSchema.Type;

export const waitOutputSettledTool: BespokeTool = {
  input: WaitOutputSettledArgsSchema,
  mutates: false,
  title: "Wait for a terminal to go quiet",
  description:
    'Block until a terminal\'s output has been idle for idleMs milliseconds — the agent-agnostic done-signal (the dispatch loop\'s "observe the TUI settle" step). Pass screenTail: N to also get the last N screen lines, read inside the same wait, instead of a follow-up screen_text the terminal can move under. Returns {result: "met", met: {fired, elapsedMs, screen?}} or {result: "timeout"|"gone"|"closed", elapsedMs?, error?}. ONLY "gone" means the terminal is dead: "closed" means this subscription dropped while the terminal was still live, so retry rather than concluding anything about the agent. A terminal that is ASLEEP is REFUSED immediately (an error naming it, with state "sleeping" or "parked") rather than waited on — wake it and wait again. To supervise several terminals without re-arming a wait per turn, prefer watch_open + watch_next.',
  handler: (args, client, signal) =>
    refusingAsleep(
      Effect.tryPromise(async (fiberSignal) => {
        const { id, idleMs, screenTail, timeoutMs } =
          args as WaitOutputSettledArgs;
        const { awaitOutputSettled } = await import("@kolu/padi-client/watch");
        const outcome = await awaitOutputSettled(padiOf(client), {
          id,
          idleMs,
          screenTail,
          timeoutMs,
          signal: signal ?? fiberSignal,
        });
        return waitJson<{ fired: "idle"; elapsedMs: number; screen?: string }>(
          id,
          outcome,
        );
      }),
    ),
};

export const WaitAgentStateArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
  until: Schema.Array(Schema.Literals(WAIT_STATES))
    .annotate({
      description:
        "Resolve once the terminal's detected agent enters ANY of these buckets: working (thinking/tool_use), awaiting (needs the human), waiting (idle prompt, its turn over), starting (the agent came up and its screen is still being drawn), fresh (that screen has settled and nothing has been said to it yet — the one to wait for before briefing a worker you just launched).",
    })
    .check(Schema.isNonEmpty()),
  settledMs: Schema.optionalKey(
    MillisecondsSchema(
      'ALSO require the terminal\'s output to have been quiet this long before reporting met — a CONJUNCT, not a second wait. Without it, an agent whose main loop ended its turn while a subagent is still running reads as done within milliseconds; bytes still moving keep this wait open, and a bucket that drops back to working re-enters it. 15000 is the field-calibrated value for "the turn is really over".',
    ),
  ),
  screenTail: ScreenTailSchema,
  timeoutMs: TimeoutMsSchema,
});
export type WaitAgentStateArgs = typeof WaitAgentStateArgsSchema.Type;

export const waitAgentStateTool: BespokeTool = {
  input: WaitAgentStateArgsSchema,
  mutates: false,
  title: "Wait for a terminal's agent state",
  description:
    'Block until a terminal\'s detected agent state enters a target bucket (working / awaiting / waiting / starting / fresh) — the precise agent-state done-signal. An agent ALREADY in a target bucket resolves immediately. To wait for a worker you have just LAUNCHED to be sayable, pass until: ["fresh"]: that is the agent up with its screen settled and nothing said to it yet, which is when agent_say takes (it REFUSES an agent that is still "starting"). To ask "is this worker\'s turn REALLY over, and what did it say?" in ONE race-free call — the `kolu debrief` protocol — pass until: ["awaiting","waiting"], settledMs: 15000, screenTail: 40; the three-call version (wait for the bucket, wait for quiet, read the screen) has a hole in each gap. Returns {result: "met", met: {agent, elapsedMs, screen?}} or {result: "timeout"|"gone"|"closed", elapsedMs?, error?}. ONLY "gone" means the terminal is dead: "closed" means this subscription dropped while the terminal was still live, so retry rather than concluding anything about the agent. A terminal that is ASLEEP is REFUSED immediately (an error naming it, with state "sleeping" or "parked") rather than waited on — wake it and wait again. To supervise several terminals without re-arming a wait per turn, prefer watch_open + watch_next.',
  handler: (args, client, signal) =>
    refusingAsleep(
      Effect.tryPromise(async (fiberSignal) => {
        const { id, until, settledMs, screenTail, timeoutMs } =
          args as WaitAgentStateArgs;
        const { awaitAgentState } = await import("@kolu/padi-client/watch");
        const outcome = await awaitAgentState(padiOf(client), {
          id,
          targets: new Set(until),
          settledMs,
          screenTail,
          timeoutMs,
          signal: signal ?? fiberSignal,
        });
        return waitJson<{
          agent: AgentInfo;
          elapsedMs: number;
          screen?: string;
        }>(id, outcome);
      }),
    ),
};
