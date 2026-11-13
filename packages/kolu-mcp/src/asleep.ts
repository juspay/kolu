/**
 * "That terminal is asleep", as this face says it — one sentence and one
 * structured detail, for every tool that reaches a terminal through padi's
 * active-terminal gate (kolu#2361).
 *
 * padi now answers two different things for an id a screen read cannot serve:
 * `TerminalNotFound` (nothing by that name) and `TerminalNotActive` (it is in
 * the roster, asleep or parked — wake it and ask again). The second is the
 * actionable one, and it has to ARRIVE as actionable: an agent told "not found"
 * drops the terminal, where an agent told "asleep" wakes it.
 *
 * A declared error decoded off a surface hop is NOT a {@link ToolFailure}, so
 * `@kolu/surface-mcp`'s generic rendering gives it a sentence and no
 * `structuredContent` (see `ToolFailure`'s own doc: "the MCP server process is
 * where a refusal is tagged"). This module is that tagging, done once:
 *
 *   - the SENTENCE is this face's, composed from the id and the arm, so it
 *     names the fix ("wake it before reading its screen"). Composed rather than
 *     taken from the error's `message` because the fleet face rewrites the id
 *     in the prose into a `<host>/<id>` reference, which only works when the
 *     bare id it rewrites is also in the detail;
 *   - the DETAIL carries padi's tag beside the id and the arm, so a driver
 *     branches on data — `kind` for this face's refusal vocabulary (the shape
 *     every other kolu-mcp refusal uses), `tag` for the declared error on the
 *     wire it was lifted from.
 *
 * Both `wait_*` tools route through here too: their engine REFUSES a wait on a
 * dormant terminal up front rather than settling an outcome that would be a lie
 * (see `@kolu/padi-client/watch`), and that refusal is this same declared error.
 */

import { terminalNotActiveOf } from "@kolu/padi-client/surface";
import { ToolFailure } from "@kolu/surface-mcp/tools";
import { Effect } from "effect";

/** The refusal an agent reads out of `structuredContent` when it aimed a
 *  terminal tool at a terminal that is asleep (or parked). */
export interface TerminalAsleepRefusal extends Record<string, unknown> {
  readonly kind: "terminal-not-active";
  /** padi's declared-error tag, carried so a driver can tie this refusal to the
   *  wire contract that produced it rather than to this face's prose. */
  readonly tag: "TerminalNotActive";
  readonly id: string;
  readonly state: "sleeping" | "parked";
}

/** `err` as this face's refusal, or `undefined` when it is some other failure.
 *
 *  Unwraps one `cause` level on the way in: the `wait_*` tools lift a
 *  Promise-shaped waiter through `Effect.tryPromise`, which wraps a rejection in
 *  an `UnknownError` whose `cause` is the value that was thrown. Reading only
 *  the top of that chain is how a typed refusal silently becomes prose. */
export function terminalAsleepFailure(
  err: unknown,
): ToolFailure<TerminalAsleepRefusal> | undefined {
  const found =
    terminalNotActiveOf(err) ??
    (typeof err === "object" && err !== null && "cause" in err
      ? terminalNotActiveOf(err.cause)
      : undefined);
  if (found === undefined) return undefined;
  const { id, state } = found;
  return new ToolFailure<TerminalAsleepRefusal>(
    // The sentence names the FIX, not just the diagnosis — and names it as a
    // thing the reader can DO rather than as a tool on this face: waking a
    // terminal is canvas-owned (`lifecycle.wake` is denied on both
    // projections, see `expose.ts`), so an agent either asks the human to wake
    // it or skips it and says it is asleep.
    state === "parked"
      ? `Terminal ${id} is parked — it is a saved terminal waiting to be restored, so it has no live screen to read`
      : `Terminal ${id} is asleep — wake it before reading its screen, or skip it and say it is asleep`,
    { kind: "terminal-not-active", tag: "TerminalNotActive", id, state },
  );
}

/** Run `effect`, turning padi's `TerminalNotActive` into this face's refusal and
 *  leaving every other failure exactly as it was. The ONE wrapper every
 *  terminal-addressing tool in this package takes, so the sentence and the
 *  detail cannot drift tool by tool. */
export function refusingAsleep<A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ToolFailure<TerminalAsleepRefusal>, R> {
  return Effect.catch(
    effect,
    (
      err,
    ): Effect.Effect<never, E | ToolFailure<TerminalAsleepRefusal>, never> =>
      Effect.fail(terminalAsleepFailure(err) ?? err),
  );
}
