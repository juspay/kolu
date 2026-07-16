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
  type PadiSurfaceClient,
  WAIT_STATES,
} from "@kolu/padi/dial";
import { unenrolledStreamCall } from "@kolu/surface/client";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import {
  MAX_TIMER_MS,
  runWait,
  type WaitMet,
  type WaitOutcome,
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

/** Serialize a wait outcome to the tool's JSON frame — a uniform `result`
 *  discriminant on EVERY outcome, never exit-code archaeology. The met payload
 *  is NESTED under `met`, never spread flat: a flat spread would let a payload
 *  key silently overwrite the envelope's reserved `id`/`result` (the same
 *  collision class `WaitMet`'s `kind?: never` closes one layer down, reopened
 *  at the wire) — nesting makes it inexpressible for ANY payload shape. The
 *  param stays `WaitMet`-typed for the same reason: widening to a bare Record
 *  would erase the kind guard at this boundary. */
export function waitJson<Met extends WaitMet>(
  id: string,
  outcome: WaitOutcome<Met>,
): Record<string, unknown> {
  // Inside the GENERIC, TS intersects the met arm's {kind:"met"} with the
  // BOUND's `kind?: never` and collapses it to never, so the discriminated
  // switch can't be written on `outcome` directly. Re-spell the same runtime
  // union once, with the met payload opaque — every CONCRETE Met satisfies
  // WaitMet (no `kind`), so this cast never changes a real shape.
  const o = outcome as
    | ({ kind: "met" } & Record<string, unknown>)
    | { kind: "gone"; elapsedMs: number }
    | { kind: "timeout"; elapsedMs: number }
    | { kind: "interrupted" }
    | { kind: "closed"; error?: string };
  switch (o.kind) {
    case "met": {
      const { kind: _kind, ...met } = o;
      return { id, result: "met", met };
    }
    case "timeout":
      return { id, result: "timeout", elapsedMs: o.elapsedMs };
    case "gone":
      return { id, result: "gone", elapsedMs: o.elapsedMs };
    case "interrupted":
      return { id, result: "interrupted" };
    case "closed":
      return {
        id,
        result: "closed",
        ...(o.error !== undefined ? { error: o.error } : {}),
      };
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

/** Block until terminal `id`'s output has been quiet for `idleMs` — the data
 *  layer of `wait_outputSettled`, exported for the e2e pin. The watcher binds
 *  padiSurface's members (`terminalAttach` + `terminalExit` + the `terminals`
 *  key set for the lost-feed discrimination) — a non-verbatim twin of
 *  kaval-tui's watcher over `ptyHostSurface`, kept local per the
 *  port-not-extract doctrine. */
export async function awaitOutputSettled(
  client: PadiSurfaceClient,
  opts: {
    id: string;
    idleMs: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<WaitOutcome<{ fired: "idle"; elapsedMs: number }>> {
  return runWait(
    { timeoutMs: opts.timeoutMs, signal: opts.signal },
    async (ctx) => {
      // The idle window: armed by the snapshot (an already-idle terminal fires
      // after idleMs), reset by every subsequent frame. A STREAM_RETRY
      // resubscribe re-delivers a fresh snapshot, which re-arms the window —
      // quiescence across a reconnect gap is unobservable, so the window
      // honestly restarts.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const disarmIdle = (): void => {
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
      };
      const armIdle = (): void => {
        disarmIdle();
        idleTimer = setTimeout(
          () =>
            ctx.settle({
              kind: "met",
              fired: "idle",
              elapsedMs: ctx.elapsedMs(),
            }),
          opts.idleMs,
        );
      };

      let feedError: string | undefined;

      // The output feed ended before any outcome and without an abort we caused.
      // Same discrimination as kaval-tui's wait: the terminal exited (its id has
      // left the `terminals` key set → `gone`), or the feed was dropped while
      // the PTY is still live (→ `closed`, loud). The idle timer is DISARMED
      // first — leaving it armed would fire a FALSE `met` off the last frame of
      // a feed we can no longer observe.
      const settleOnLostFeed = async (): Promise<void> => {
        disarmIdle();
        try {
          const keys = await firstFrameOrThrow(
            await client.surface.terminals.keys({}),
            "padi terminals keys yielded no snapshot frame — link or protocol failure.",
          );
          if (!keys.includes(opts.id as (typeof keys)[number])) {
            ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
            return;
          }
        } catch (err) {
          feedError ??= errMessage(err);
          ctx.recordUpstreamError(errMessage(err));
        }
        ctx.settle({
          kind: "closed",
          error:
            feedError ??
            `the daemon ended ${opts.id}'s output feed while its terminal is still live — retry wait_outputSettled.`,
        });
      };

      const consumeOutput = async (): Promise<void> => {
        try {
          const stream = await unenrolledStreamCall(
            (input: { id: string }, o) =>
              client.surface.terminalAttach.get(input, o),
            { id: opts.id },
            { signal: ctx.signal },
          );
          // Snapshot AND delta frames both (re)arm the window — the snapshot is
          // the replay of the current screen (the moment to start the quiet
          // window), each delta is fresh output resetting it.
          for await (const _frame of stream) armIdle();
          if (!ctx.signal.aborted) await settleOnLostFeed();
        } catch (err) {
          // An abort (the window fired, a timeout, a cancelled request) is the
          // expected end. A non-abort error is a dropped feed — a dead transport
          // rejects non-retryably through STREAM_RETRY's fence and lands here.
          if (!ctx.signal.aborted) {
            feedError ??= errMessage(err);
            ctx.recordUpstreamError(errMessage(err));
            await settleOnLostFeed();
          }
        }
      };

      const consumeExit = async (): Promise<void> => {
        try {
          const stream = await unenrolledStreamCall(
            (input: { id: string }, o) =>
              client.surface.terminalExit.get(input, o),
            { id: opts.id },
            { signal: ctx.signal },
          );
          for await (const _msg of stream) {
            ctx.settle({ kind: "gone", elapsedMs: ctx.elapsedMs() });
            return;
          }
        } catch {
          // Losing the exit event is NOT fatal: a real exit also ends the
          // terminalAttach feed → settleOnLostFeed → gone (consumeOutput is the
          // backstop). An abort is likewise the expected end. Mirrors kaval-tui's
          // consumeExit non-recording rationale.
        }
      };

      try {
        await Promise.all([consumeOutput(), consumeExit()]);
      } finally {
        // The scaffold clears ITS timeout; the idle window is this watcher's own.
        disarmIdle();
      }
    },
  );
}

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
