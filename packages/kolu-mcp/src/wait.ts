/**
 * The composite `wait_*` tools — the MCP face's done-signals, and the
 * load-bearing rows of the /orchestrator·/kolu skill-parity contract (the
 * send → settle → Enter → settle dispatch loop is the whole protocol):
 *
 *   - `wait_outputSettled` — block until a terminal's output is idle for N ms:
 *     the `kaval-tui wait --until idle:<ms>` done-signal, watched client-side
 *     off padiSurface's `terminalAttach` snapshot|delta stream (consumed,
 *     never rendered — the graduation pin's second non-canvas consumer).
 *     v1 is the idle signal only; `match:` stays CLI-only.
 *   - `wait_agentState` — block until a terminal's detected agent enters a
 *     target bucket: the `padi-tui wait --until <buckets>` done-signal, riding
 *     the dial kit's `awaitAgentState` (the VERBATIM twin this graduation
 *     exists for).
 *
 * Both are client-side scaffolding over `@kolu/surface/wait`'s `runWait` —
 * NOT padiSurface procedures; padi gains no wait verb. The subscriptions
 * thread `STREAM_RETRY` (`unenrolledStreamCall`), so a stream blip
 * resubscribes transparently and the fresh snapshot re-arms the idle window;
 * a dead transport rejects non-retryably and surfaces as a typed `closed`
 * outcome the agent can retry.
 */

import {
  awaitAgentState,
  awaitOutputSettled,
  type PadiSurfaceClient,
  WAIT_STATES,
} from "@kolu/padi/dial";
import {
  MAX_TIMER_MS,
  type WaitMet,
  type WaitOutcome,
  waitOutcomeJson,
} from "@kolu/surface/wait";
import type { BespokeTool } from "@kolu/surface-mcp";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";

// ── Shared arg pieces ─────────────────────────────────────────────────────

/** A milliseconds field: a positive integer inside the shared `setTimeout`
 *  ceiling, carrying the blurb an MCP host renders.
 *
 *  ANNOTATE FIRST, CHECK SECOND — `SchemaAST.annotate` attaches to a schema's
 *  LAST CHECK when it has one, and a check's annotations are emitted inside an
 *  `allOf` branch where no host reads a property description (`Schema.Int` is
 *  itself `Schema.Number.check(isInt())`, so it is already "checked"). Adding
 *  `isInt` as a check instead keeps the blurb on the node AND still advertises
 *  the field as an integer rather than as bare `Schema.Number`, whose encoded
 *  form admits the strings `"NaN"`/`"Infinity"` (D8/#14 divergence 2). Pinned
 *  in `argSchemas.test.ts`. */
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

/** Serialize a wait outcome to the tool's JSON frame via the shared
 *  {@link waitOutcomeJson} (which owns the four terminal arms and the union
 *  re-spell). The MCP face NESTS the met payload under `met`, never spread flat:
 *  a flat spread would let a payload key silently overwrite the envelope's
 *  reserved `id`/`result` (the collision `WaitMet`'s `kind?: never` closes one
 *  layer down, reopened at the wire) — nesting makes it inexpressible for ANY
 *  payload shape. The param stays `WaitMet`-typed for the same reason. */
export function waitJson<Met extends WaitMet>(
  id: string,
  outcome: WaitOutcome<Met>,
): Record<string, unknown> {
  return waitOutcomeJson(id, outcome, (met) => ({ met }));
}

// ── wait_outputSettled ────────────────────────────────────────────────────

export const WaitOutputSettledArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
  idleMs: MillisecondsSchema(
    'Resolve once no output has arrived for this many milliseconds — the agent-agnostic "turn ended / awaiting input" signal (e.g. 800).',
  ),
  timeoutMs: TimeoutMsSchema,
});
export type WaitOutputSettledArgs = typeof WaitOutputSettledArgsSchema.Type;

export const waitOutputSettledTool: BespokeTool = {
  input: WaitOutputSettledArgsSchema,
  mutates: false,
  description:
    'Block until a terminal\'s output has been idle for idleMs milliseconds — the agent-agnostic done-signal (the dispatch loop\'s "observe the TUI settle" step). Returns {result: "met", met: {fired, elapsedMs}} or {result: "timeout"|"gone"|"closed", elapsedMs?, error?}. ONLY "gone" means the terminal is dead: "closed" means this subscription dropped while the terminal was still live, so retry rather than concluding anything about the agent. To supervise several terminals without re-arming a wait per turn, prefer watch_open + watch_next.',
  // The one bespoke tool that does NOT compose a surface member: padi's
  // `awaitOutputSettled` is a Promise-shaped waiter that takes an AbortSignal,
  // so this LIFTS it rather than composing it. That is why `signal` survives on
  // `BespokeTool.handler` at all — it is forwarded to the scaffold, and the
  // request edge's own interruption is what aborts it.
  handler: (args, client, signal) =>
    Effect.tryPromise(async () => {
      const { id, idleMs, timeoutMs } = args as WaitOutputSettledArgs;
      const outcome = await awaitOutputSettled(client as PadiSurfaceClient, {
        id,
        idleMs,
        timeoutMs,
        signal,
      });
      return waitJson<{ fired: "idle"; elapsedMs: number }>(id, outcome);
    }),
};

// ── wait_agentState ───────────────────────────────────────────────────────

export const WaitAgentStateArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
  // Annotate first, check second — see `MillisecondsSchema` above.
  until: Schema.Array(Schema.Literals(WAIT_STATES))
    .annotate({
      description:
        "Resolve once the terminal's detected agent enters ANY of these buckets: working (thinking/tool_use), awaiting (needs the human), waiting (idle prompt).",
    })
    .check(Schema.isNonEmpty()),
  timeoutMs: TimeoutMsSchema,
});
export type WaitAgentStateArgs = typeof WaitAgentStateArgsSchema.Type;

export const waitAgentStateTool: BespokeTool = {
  input: WaitAgentStateArgsSchema,
  mutates: false,
  description:
    'Block until a terminal\'s detected agent state enters a target bucket (working / awaiting / waiting) — the precise agent-state done-signal. An agent ALREADY in a target bucket resolves immediately. Returns {result: "met", met: {agent, elapsedMs}} or {result: "timeout"|"gone"|"closed", elapsedMs?, error?}. ONLY "gone" means the terminal is dead: "closed" means this subscription dropped while the terminal was still live, so retry rather than concluding anything about the agent. To supervise several terminals without re-arming a wait per turn, prefer watch_open + watch_next.',
  // Lifted, not composed — same reason as `wait_outputSettled` above.
  handler: (args, client, signal) =>
    Effect.tryPromise(async () => {
      const { id, until, timeoutMs } = args as WaitAgentStateArgs;
      const outcome = await awaitAgentState(client as PadiSurfaceClient, {
        id,
        targets: new Set(until),
        timeoutMs,
        signal,
      });
      return waitJson<{ agent: AgentInfo; elapsedMs: number }>(id, outcome);
    }),
};
