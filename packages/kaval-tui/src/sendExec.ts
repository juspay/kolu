import { Effect } from "effect";
import type { SendPlan } from "./send.ts";

export const SEND_WRITE_DEADLINE_MS = 8_000;

export function executeSendPlan(
  plan: SendPlan,
  write: (data: string) => Effect.Effect<void, unknown>,
  target: string,
): Effect.Effect<void, unknown> {
  return Effect.timeoutOrElse(write(plan.write), {
    duration: SEND_WRITE_DEADLINE_MS,
    orElse: () =>
      Effect.fail(
        new Error(
          `write to terminal ${target} stalled — no acknowledgement within ${SEND_WRITE_DEADLINE_MS}ms. The terminal is not draining its input (a program that has stopped reading stdin?). Aborting rather than hanging.`,
        ),
      ),
  });
}
