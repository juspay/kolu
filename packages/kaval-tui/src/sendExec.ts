/**
 * The effectful executor for a {@link SendPlan} — the ONE place that turns a
 * plan into ordered writes on the wire, under a bounded per-write deadline. It
 * is the interpreter half of the send feature: `send.ts` builds the plan (pure,
 * no I/O), this runs it (the write sink is injected, so the transport stays out
 * of the plan). Both `main.ts`'s `cmdSend` and the acceptance test call THIS, so
 * the test exercises the shipped sequencing + deadline instead of a replica.
 *
 * The deadline exists because a `terminal.write` can BLOCK indefinitely when the
 * target isn't draining its input — a program that stops reading stdin (a plain
 * `cat` whose output has backed up) lets the PTY's input buffer fill, and the
 * write never acks. A one-shot CLI must not hang on that: unlike tmux — whose
 * persistent server buffers the input asynchronously and returns at once — we
 * have no server-side buffer to hand off to, so the fail-fast analog is to BOUND
 * the write and exit loud. The bound is FIXED in code, deliberately not a flag:
 * a knob here would just be another thing to tune, and the honest behavior
 * (never hang) shouldn't be defeatable.
 */
import { Effect } from "effect";
import type { SendPlan } from "./send.ts";

/** How long a single `terminal.write` may take before `send` gives up and fails
 *  loud rather than hanging. Fixed, not a flag: comfortably longer than any
 *  healthy write (a big paste to a draining TUI acks in well under a second) yet
 *  short enough that a stalled terminal fails in seconds, not the >1min the
 *  unbounded write blocked for. */
export const SEND_WRITE_DEADLINE_MS = 8_000;

/** Drive a {@link SendPlan} to a terminal via the injected `write` sink: issue
 *  the plan's single write, bounded by {@link SEND_WRITE_DEADLINE_MS}. A write
 *  that doesn't complete in time throws a loud error naming `target` (the stalled
 *  terminal) — the caller surfaces it as `kaval-tui: <msg>` and exits non-zero,
 *  so `send` never hangs on a terminal that isn't consuming input. */
export function executeSendPlan(
  plan: SendPlan,
  write: (data: string) => Effect.Effect<void, unknown>,
  target: string,
): Effect.Effect<void, unknown> {
  // The whole "race one write against a deadline" dance — a `new Promise` whose
  // `reject` fires from a `setTimeout`, a `Promise.race`, and a `.finally` to
  // clear the timer so a fast write doesn't hold the event loop open — is one
  // combinator. The timer cannot be leaked because there is no timer to leak,
  // and the abandoned write is abandoned by interruption rather than left
  // running with nobody attached to its rejection.
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
