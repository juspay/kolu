import { terminalNotActiveOf } from "@kolu/padi-client/surface";
import { ToolFailure } from "@kolu/surface-mcp/tools";
import { Effect } from "effect";

export interface TerminalAsleepRefusal extends Record<string, unknown> {
  readonly kind: "terminal-not-active";
  readonly tag: "TerminalNotActive";
  readonly id: string;
  readonly state: "sleeping" | "parked";
}

export function terminalAsleepRefusal(
  id: string,
  state: "sleeping" | "parked",
): ToolFailure<TerminalAsleepRefusal> {
  return new ToolFailure<TerminalAsleepRefusal>(
    state === "parked"
      ? `Terminal ${id} is parked — it is a saved terminal waiting to be restored, so it has no live screen to read`
      : `Terminal ${id} is asleep — wake it before reading its screen, or skip it and say it is asleep`,
    { kind: "terminal-not-active", tag: "TerminalNotActive", id, state },
  );
}

export function terminalAsleepFailure(
  err: unknown,
): ToolFailure<TerminalAsleepRefusal> | undefined {
  const found =
    terminalNotActiveOf(err) ??
    (typeof err === "object" && err !== null && "cause" in err
      ? terminalNotActiveOf(err.cause)
      : undefined);
  if (found === undefined) return undefined;
  return terminalAsleepRefusal(found.id, found.state);
}

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
