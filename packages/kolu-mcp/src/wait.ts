/**
 * The composite `wait_*` tools — the MCP face's done-signals, and the
 * load-bearing rows of the /orchestrator·/kolu skill-parity contract (the
 * send → settle → Enter → settle dispatch loop is the whole protocol):
 *
 *   - `wait_outputSettled` — block until a terminal's output is idle for N ms:
 *     the `kaval-tui wait --until idle:<ms>` done-signal, watched client-side
 *     off padiSurface's `terminalAttach` snapshot|delta stream (consumed,
 *     never rendered — the graduation pin's second non-canvas consumer).
 *     The idle signal only; `match:` stays CLI-only.
 *   - `wait_agentState` — block until a terminal's detected agent enters a
 *     target bucket: the `padi-tui wait --until <buckets>` done-signal, riding
 *     the dial kit's `awaitAgentState` (the VERBATIM twin this graduation
 *     exists for).
 *
 * Both take the two kolu#2139 modifiers, because the races those close are
 * races between CALLS and an agent driving over MCP makes exactly the same
 * three-call loop a CLI one does: `settledMs` (a conjunct — met needs the
 * condition to hold AND the output to have been quiet) and `screenTail` (the met
 * carries the last N screen lines, read inside the same wait). Both are
 * forwarded to padi's engine through the two named waits rather than around
 * them, because those waits own the met frames these tools document — see
 * `awaitAgentState`. `wait_agentState` with both is the `kolu debrief` protocol,
 * and this face states it in the tool description instead of shipping a third
 * composed tool (see the note there).
 *
 * Both are client-side scaffolding over `@kolu/surface/wait`'s `runWait` —
 * NOT padiSurface procedures; padi gains no wait verb. The subscriptions
 * thread `STREAM_RETRY` (`unenrolledStreamCall`), so a stream blip
 * resubscribes transparently and the fresh snapshot re-arms the idle window;
 * a dead transport rejects non-retryably and surfaces as a typed `closed`
 * outcome the agent can retry.
 */

// The dial kit arrives dynamically, INSIDE the handlers: this module is on the
// static tree-build path of every `kolu` invocation (the surface face mounts
// the table), so the waiters' socket/mirror closure may only load at call
// time. WAIT_STATES has a schema home of its own and belongs here statically.
import type { PadiSurfaceClient } from "@kolu/padi/dial";
// The tail slice is padi's — the same fold `screen_text`'s `tail` and `kolu
// wait --snapshot` use, so "the last N lines" means one thing on every face.
import { tailLines } from "@kolu/padi/render";
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

/** The `--snapshot` modifier, as an MCP option: how much screen a met carries.
 *
 *  LINES, not a boolean, because the face has to bound the payload anyway — the
 *  engine hands back the WHOLE rendered buffer and slicing it is the caller's
 *  rendering decision (`kolu wait --snapshot N` makes the same one). One number
 *  says both "yes, capture" and "this much", so there is no way to ask for a
 *  screen and forget to bound it. */
const ScreenTailSchema = Schema.optionalKey(
  // Annotate first, check second — see `MillisecondsSchema` above.
  Schema.Number.annotate({
    description:
      "Also return the terminal's last N rendered lines on the met, read INSIDE this wait — so no second screen_text call can race the terminal between the signal and the read.",
  }).check(Schema.isInt(), Schema.isGreaterThan(0)),
);

/** Serialize a wait outcome to the tool's JSON frame via the shared
 *  {@link waitOutcomeJson} (which owns the four terminal arms and the union
 *  re-spell). The MCP face NESTS the met payload under `met`, never spread flat:
 *  a flat spread would let a payload key silently overwrite the envelope's
 *  reserved `id`/`result` (the collision `WaitMet`'s `kind?: never` closes one
 *  layer down, reopened at the wire) — nesting makes it inexpressible for ANY
 *  payload shape. The param stays `WaitMet`-typed for the same reason.
 *
 *  `screenTail` bounds a captured screen to its last N lines. It lives HERE, at
 *  the face's one met→frame projection, rather than in each handler, because it
 *  is one rendering decision about one wire: the engine hands back the WHOLE
 *  rendered buffer by design (bounding it is the caller's call), and both wait
 *  tools bound it identically. The slice is `@kolu/padi/render`'s `tailLines` —
 *  the same fold `screen_text`'s own `tail` and `kolu wait --snapshot` use, so
 *  "the last N lines" means one thing across every face. */
export function waitJson<Met extends WaitMet>(
  id: string,
  outcome: WaitOutcome<Met>,
  screenTail?: number,
): Record<string, unknown> {
  return waitOutcomeJson(id, outcome, (met) => ({
    met: screenTail === undefined ? met : boundScreen(met, screenTail),
  }));
}

/** The met payload with its `screen` cut to the last `tail` lines.
 *
 *  Typed as `object` because `waitOutcomeJson` hands the payload over opaque —
 *  this is the one place that reads a field out of it, so the narrowing is
 *  spelled once, here, rather than by making every met shape re-declare a key
 *  only two of them ever carry. There is no absent-screen arm to invent: the
 *  engine crashes rather than settling a met that asked for a screen without
 *  one, so a payload reaching here with none is a wait that never asked. */
function boundScreen(met: object, tail: number): object {
  const screen = (met as { readonly screen?: unknown }).screen;
  return typeof screen === "string"
    ? { ...met, screen: tailLines(screen, tail) }
    : met;
}

// ── wait_outputSettled ────────────────────────────────────────────────────

export const WaitOutputSettledArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
  idleMs: MillisecondsSchema(
    'Resolve once no output has arrived for this many milliseconds — the agent-agnostic "turn ended / awaiting input" signal (e.g. 800).',
  ),
  screenTail: ScreenTailSchema,
  timeoutMs: TimeoutMsSchema,
});
export type WaitOutputSettledArgs = typeof WaitOutputSettledArgsSchema.Type;

// No `settledMs` here, deliberately: this condition IS a quiescence window, and
// a second one over it would only ever mean "quiet for max(idleMs, settledMs)"
// — every setting of it is already spellable with `idleMs`. The conjunct earns
// its place on `wait_agentState`, where the condition is a bucket and quiet is
// genuinely a second, independent fact. See `awaitOutputSettled`'s own note.
export const waitOutputSettledTool: BespokeTool = {
  input: WaitOutputSettledArgsSchema,
  mutates: false,
  title: "Wait for a terminal to go quiet",
  description:
    'Block until a terminal\'s output has been idle for idleMs milliseconds — the agent-agnostic done-signal (the dispatch loop\'s "observe the TUI settle" step). Pass screenTail: N to also get the last N screen lines, read inside the same wait, instead of a follow-up screen_text the terminal can move under. Returns {result: "met", met: {fired, elapsedMs, screen?}} or {result: "timeout"|"gone"|"closed", elapsedMs?, error?}. ONLY "gone" means the terminal is dead: "closed" means this subscription dropped while the terminal was still live, so retry rather than concluding anything about the agent. To supervise several terminals without re-arming a wait per turn, prefer watch_open + watch_next.',
  // The one bespoke tool that does NOT compose a surface member: padi's
  // `awaitOutputSettled` is a Promise-shaped waiter that takes an AbortSignal,
  // so this LIFTS it rather than composing it. That is why `signal` survives on
  // `BespokeTool.handler` at all — it is forwarded to the scaffold, and the
  // request edge's own interruption is what aborts it.
  //
  // The `tryPromise` is the OPTIONS form on purpose: a zero-arg `async` fn
  // mints no AbortSignal, and a fiber interrupt can then never reach the
  // waiter — on the argv face, where `signal` arrives as `undefined`, a
  // Ctrl-C against an unbounded wait would hang instead of the matrix's 130.
  // `signal ?? fiberSignal`: the MCP edge's request signal when one was
  // handed, the fiber's own interrupt handle in every other case.
  handler: (args, client, signal) =>
    Effect.tryPromise(async (fiberSignal) => {
      const { id, idleMs, screenTail, timeoutMs } =
        args as WaitOutputSettledArgs;
      const { awaitOutputSettled } = await import("@kolu/padi/dial");
      const outcome = await awaitOutputSettled(client as PadiSurfaceClient, {
        id,
        idleMs,
        captureScreen: screenTail !== undefined,
        timeoutMs,
        signal: signal ?? fiberSignal,
      });
      return waitJson<{ fired: "idle"; elapsedMs: number; screen?: string }>(
        id,
        outcome,
        screenTail,
      );
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
  // The recommended combination is named in the description rather than shipped
  // as a third `wait_debrief` tool: over MCP it is three JSON keys, so a
  // composed tool would buy no ergonomics an agent can feel while costing a
  // whole tool's worth of description in every request's context — and it would
  // force `kolu debrief`'s protocol constants out of the CLI leaf that owns
  // them into a home both faces reach, for defaults each face can just state.
  description:
    'Block until a terminal\'s detected agent state enters a target bucket (working / awaiting / waiting) — the precise agent-state done-signal. An agent ALREADY in a target bucket resolves immediately. To ask "is this worker\'s turn REALLY over, and what did it say?" in ONE race-free call — the `kolu debrief` protocol — pass until: ["awaiting","waiting"], settledMs: 15000, screenTail: 40; the three-call version (wait for the bucket, wait for quiet, read the screen) has a hole in each gap. Returns {result: "met", met: {agent, elapsedMs, screen?}} or {result: "timeout"|"gone"|"closed", elapsedMs?, error?}. ONLY "gone" means the terminal is dead: "closed" means this subscription dropped while the terminal was still live, so retry rather than concluding anything about the agent. To supervise several terminals without re-arming a wait per turn, prefer watch_open + watch_next.',
  // Lifted, not composed — same reason as `wait_outputSettled` above,
  // including the AbortSignal the one-form `tryPromise` would leave unmilled
  // (a Ctrl-C on an unbounded argv wait would hang, never the matrix's 130).
  handler: (args, client, signal) =>
    Effect.tryPromise(async (fiberSignal) => {
      const { id, until, settledMs, screenTail, timeoutMs } =
        args as WaitAgentStateArgs;
      const { awaitAgentState } = await import("@kolu/padi/dial");
      const outcome = await awaitAgentState(client as PadiSurfaceClient, {
        id,
        targets: new Set(until),
        settledMs,
        captureScreen: screenTail !== undefined,
        timeoutMs,
        signal: signal ?? fiberSignal,
      });
      return waitJson<{
        agent: AgentInfo;
        elapsedMs: number;
        screen?: string;
      }>(id, outcome, screenTail);
    }),
};
