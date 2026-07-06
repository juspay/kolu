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
export async function executeSendPlan(
  plan: SendPlan,
  write: (data: string) => Promise<void>,
  target: string,
): Promise<void> {
  await writeWithDeadline(write, plan.write, target);
}

/** Race one write against the deadline. On timeout, reject loud; the pending
 *  write is abandoned (harmless for a one-shot CLI that then exits). The timer
 *  is always cleared so a fast write doesn't hold the event loop open. */
function writeWithDeadline(
  write: (data: string) => Promise<void>,
  data: string,
  target: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `write to terminal ${target} stalled — no acknowledgement within ${SEND_WRITE_DEADLINE_MS}ms. The terminal is not draining its input (a program that has stopped reading stdin?). Aborting rather than hanging.`,
        ),
      );
    }, SEND_WRITE_DEADLINE_MS);
  });
  return Promise.race([write(data), deadline]).finally(() =>
    clearTimeout(timer),
  );
}
