/**
 * The effectful executor for a {@link SendPlan} — the ONE place that turns a
 * plan into ordered writes on the wire, with the `--submit` grace timer. It is
 * the interpreter half of the send feature: `send.ts` builds the plan (pure, no
 * I/O), this runs it (the write sink is injected, so the timer and the transport
 * stay out of the plan). Both `main.ts`'s `cmdSend` and the acceptance test call
 * THIS, so the test exercises the shipped sequencing instead of a hand-copied
 * replica — the plan interpreter lives here once, not in the consumer and its
 * test in lockstep.
 */
import { type SendPlan, SUBMIT_ENTER } from "./send.ts";

/** A promise that resolves after `ms` — the `--submit` grace between the text
 *  write and the Enter. A blind timer, not a screen read: the point is only to
 *  land the Enter after the paste debounce. */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Drive a {@link SendPlan} to a terminal via the injected `write` sink: issue
 *  each planned write in order (awaiting in turn preserves order and applies
 *  natural backpressure), then — under `--submit` — wait the grace so the Enter
 *  lands past the TUI's paste debounce, and write {@link SUBMIT_ENTER}. */
export async function executeSendPlan(
  plan: SendPlan,
  write: (data: string) => Promise<void>,
): Promise<void> {
  for (const data of plan.writes) {
    await write(data);
  }
  if (plan.submit) {
    await delay(plan.submit.graceMs);
    await write(SUBMIT_ENTER);
  }
}
