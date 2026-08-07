/**
 * `reapHolder` — stop a process we have PROVEN is our own daemon, and do not
 * return until the OS says it is gone.
 *
 * The supervisor's kill has always been SIGTERM + {@link waitForPidGone}: ask
 * politely, then wait for the reap, because respawning over a still-live gate
 * holder would just make the successor yield to it (single instance) and the
 * recycle would silently no-op. What it lacked was an ANSWER for the daemon that
 * never exits. "Wait 120 s, then throw" leaves the rendezvous held by a wedged
 * process forever and the product with no recovery but a human — the exact
 * dead-end the cross-epoch takeover cannot afford, since the whole point of
 * taking over is that the boot converges by itself.
 *
 * So the wait is now TWO deadlines, and the second one is not refusable:
 *
 * 1. **SIGTERM, then {@link REAP_TERM_CEILING_MS}.** This is the daemon's own
 *    in-process shutdown running — persist, close, release the gate. Generous
 *    (2 min) on purpose: a daemon owning gigabytes of PTY scrollback has taken
 *    that long to tear down (#1034's 25 G case), and the wait is a DEADLINE, not
 *    a delay — a healthy daemon exits in milliseconds and never approaches it.
 *    Shortening it would trade someone's persisted state for latency nobody
 *    experiences.
 * 2. **SIGKILL, then {@link REAP_KILL_CEILING_MS}.** SIGKILL is not refusable by
 *    the process: past this point the only thing that can still be alive is a
 *    task stuck in uninterruptible sleep, which no supervisor can fix. Short
 *    (5 s) for the same reason — we are waiting on the kernel, not on a program.
 *    Still alive after it ⇒ `survived`, and the caller fails LOUD.
 *
 * The outcome is a RECORD, not a boolean: which signal ended it and how long the
 * wait took are exactly what an operator needs to read after the fact, and the
 * takeover's observation line carries both.
 */
import { Effect } from "effect";
import { waitForPidGone } from "./waitForPidGone.ts";

/** How long the daemon's own graceful shutdown gets after SIGTERM. */
export const REAP_TERM_CEILING_MS = 120_000;

/** How long the KERNEL gets to reap the process after SIGKILL. */
export const REAP_KILL_CEILING_MS = 5_000;

/** What happened to the process we asked to stop — evidence as data. */
export type ReapOutcome =
  /** The process is gone; `endedBy` is the signal whose deadline it met. */
  | {
      readonly kind: "reaped";
      readonly endedBy: "SIGTERM" | "SIGKILL";
      /** Wall time from the first signal to the confirmed reap, in ms. */
      readonly waitedMs: number;
    }
  /** Still live past BOTH deadlines — uninterruptible sleep or worse. */
  | { readonly kind: "survived"; readonly waitedMs: number };

export interface ReapHolderOptions {
  /** Graceful window after SIGTERM. Default {@link REAP_TERM_CEILING_MS}. */
  termCeilingMs?: number;
  /** Kernel window after SIGKILL. Default {@link REAP_KILL_CEILING_MS}. */
  killCeilingMs?: number;
  /** Liveness poll spacing, forwarded to {@link waitForPidGone}. */
  intervalMs?: number;
}

/** Send `signal` to `pid`, tolerating the process having already exited between
 *  the liveness probe that chose it and this call — the irreducible race every
 *  kill site lives with; the wait that follows is what actually decides. */
function signalIgnoringRace(pid: number, signal: "SIGTERM" | "SIGKILL"): void {
  try {
    process.kill(pid, signal);
  } catch {
    // Raced its own exit. `waitForPidGone` below confirms it.
  }
}

/** SIGTERM `pid`, wait, escalate to SIGKILL, wait again — see the module doc.
 *  The two waits are ONE fiber, so a caller that gives up (a lost race, an
 *  interrupted converge) cancels the outstanding poll with it rather than
 *  leaving a timer running against a pid nobody is waiting on any more. */
export function reapHolder(
  pid: number,
  opts: ReapHolderOptions = {},
): Effect.Effect<ReapOutcome> {
  return Effect.gen(function* () {
    const startedAt = Date.now();
    const waited = (): number => Date.now() - startedAt;

    yield* Effect.sync(() => signalIgnoringRace(pid, "SIGTERM"));
    if (
      yield* waitForPidGone(pid, {
        timeoutMs: opts.termCeilingMs ?? REAP_TERM_CEILING_MS,
        intervalMs: opts.intervalMs,
      })
    ) {
      return { kind: "reaped", endedBy: "SIGTERM", waitedMs: waited() };
    }

    yield* Effect.sync(() => signalIgnoringRace(pid, "SIGKILL"));
    if (
      yield* waitForPidGone(pid, {
        timeoutMs: opts.killCeilingMs ?? REAP_KILL_CEILING_MS,
        intervalMs: opts.intervalMs,
      })
    ) {
      return { kind: "reaped", endedBy: "SIGKILL", waitedMs: waited() };
    }

    return { kind: "survived", waitedMs: waited() };
  });
}
