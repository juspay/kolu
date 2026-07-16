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
import { z } from "zod";

// ── Shared arg pieces ─────────────────────────────────────────────────────

const TimeoutMsSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_TIMER_MS)
  .optional()
  .describe(
    'Give up after this many milliseconds (result: "timeout"). Omit to wait indefinitely (the MCP host\'s own request timeout still applies).',
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

export const WaitOutputSettledArgsSchema = z.object({
  id: TerminalIdSchema,
  idleMs: z
    .number()
    .int()
    .positive()
    .max(MAX_TIMER_MS)
    .describe(
      'Resolve once no output has arrived for this many milliseconds — the agent-agnostic "turn ended / awaiting input" signal (e.g. 800).',
    ),
  timeoutMs: TimeoutMsSchema,
});
export type WaitOutputSettledArgs = z.infer<typeof WaitOutputSettledArgsSchema>;

export const waitOutputSettledTool: BespokeTool = {
  input: WaitOutputSettledArgsSchema,
  mutates: false,
  description:
    'Block until a terminal\'s output has been idle for idleMs milliseconds — the agent-agnostic done-signal (the dispatch loop\'s "observe the TUI settle" step). Returns {result: "met", met: {fired, elapsedMs}} or {result: "timeout"|"gone"|"closed", elapsedMs?, error?}.',
  handler: async (args, client, signal) => {
    const { id, idleMs, timeoutMs } = args as WaitOutputSettledArgs;
    const outcome = await awaitOutputSettled(client as PadiSurfaceClient, {
      id,
      idleMs,
      timeoutMs,
      signal,
    });
    return waitJson<{ fired: "idle"; elapsedMs: number }>(id, outcome);
  },
};

// ── wait_agentState ───────────────────────────────────────────────────────

export const WaitAgentStateArgsSchema = z.object({
  id: TerminalIdSchema,
  until: z
    .array(z.enum(WAIT_STATES))
    .nonempty()
    .describe(
      "Resolve once the terminal's detected agent enters ANY of these buckets: working (thinking/tool_use), awaiting (needs the human), waiting (idle prompt).",
    ),
  timeoutMs: TimeoutMsSchema,
});
export type WaitAgentStateArgs = z.infer<typeof WaitAgentStateArgsSchema>;

export const waitAgentStateTool: BespokeTool = {
  input: WaitAgentStateArgsSchema,
  mutates: false,
  description:
    'Block until a terminal\'s detected agent state enters a target bucket (working / awaiting / waiting) — the precise agent-state done-signal. An agent ALREADY in a target bucket resolves immediately. Returns {result: "met", met: {agent, elapsedMs}} or {result: "timeout"|"gone"|"closed", elapsedMs?, error?}.',
  handler: async (args, client, signal) => {
    const { id, until, timeoutMs } = args as WaitAgentStateArgs;
    const outcome = await awaitAgentState(client as PadiSurfaceClient, {
      id,
      targets: new Set(until),
      timeoutMs,
      signal,
    });
    return waitJson<{ agent: AgentInfo; elapsedMs: number }>(id, outcome);
  },
};
