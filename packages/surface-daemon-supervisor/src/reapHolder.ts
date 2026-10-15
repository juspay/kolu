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
 * Step 1 is for a daemon that HAS a shutdown handler to run. A holder observed
 * in state `T`/`t` (stopped, or tracing stop) provably does not: the SIGTERM is
 * queued, never delivered, so the graceful window can only be spent for nothing.
 * For that one the ladder starts at step 2 — SIGKILL immediately, since SIGKILL
 * IS delivered to a stopped process — and the outcome carries `reason:
 * "stopped"`. The state is read ONCE, at the moment of reap, not polled: the
 * #2101 incident paid the full 120 s ceiling against a SIGSTOP'd daemon for
 * nothing, and every second of that was wall-clock on the repair.
 *
 * **The state read is an INJECTED OS fact, never a platform traversal here.**
 * This module does not parse `/proc/<pid>/stat` or shell out to `ps`: it takes a
 * {@link ReadProcessState} — the same shape as the endpoint's other OS-fact
 * seams — and the composition root binds it to {@link processStateReader}
 * (`endpoint.ts`'s rule: *the endpoint never performs platform process traversal
 * itself*). Its error channel travels: a read that could not be COMPLETED is a
 * failure this ladder propagates (the endpoint has an answer for it — report
 * `dead`, then rethrow), never a silent "not stopped" that would spend the 120 s
 * ceiling on a guess. `undefined` from the reader is the one honest non-answer —
 * the pid is gone — and the KILL leg below reports that immediately anyway.
 *
 * The outcome is a RECORD, not a boolean: which signal ended it, how long the
 * wait took, and (when the graceful leg was skipped) why, are exactly what an
 * operator needs to read after the fact, and the takeover's observation line
 * carries them all.
 */
import { Effect } from "effect";
import type { OsfactsClientError } from "osfacts-client";
import type { ReadProcessState, ProcessState } from "./processState.ts";
import { waitForPidGone } from "./waitForPidGone.ts";

/** How long the daemon's own graceful shutdown gets after SIGTERM. */
export const REAP_TERM_CEILING_MS = 120_000;

/** How long the KERNEL gets to reap the process after SIGKILL. */
export const REAP_KILL_CEILING_MS = 5_000;

/**
 * The ONE fold from a raw OS state symbol to "this process is stopped, so it
 * cannot be running a shutdown handler". `T` is a job-control stop, `t` a
 * tracing stop; both mean the process is not executing — a SIGTERM sent to it
 * is queued, never delivered. Kept here, alone, so a new caller cannot invent a
 * second reading of the same fact.
 */
function isStoppedState(state: ProcessState | undefined): boolean {
  return state === "T" || state === "t";
}

/** What happened to the process we asked to stop — evidence as data. */
export type ReapOutcome =
  /** The process is gone; `endedBy` is the signal whose deadline it met. */
  | {
      readonly kind: "reaped";
      readonly endedBy: "SIGTERM" | "SIGKILL";
      /** Wall time from the first signal to the confirmed reap, in ms. */
      readonly waitedMs: number;
      /** Present only on the early-escalation path below: the holder was
       *  observed STOPPED (`T`/`t`), so the graceful window was skipped — it
       *  could not have been running a shutdown handler. */
      readonly reason?: "stopped";
    }
  /** Still live past BOTH deadlines — uninterruptible sleep or worse. */
  | {
      readonly kind: "survived";
      readonly waitedMs: number;
      /** Present when the graceful leg was skipped — see the `reaped` variant. */
      readonly reason?: "stopped";
    };

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

/**
 * SIGTERM `pid`, wait, escalate to SIGKILL, wait again — see the module doc.
 * The two waits are ONE fiber, so a caller that gives up (a lost race, an
 * interrupted converge) cancels the outstanding poll with it rather than
 * leaving a timer running against a pid nobody is waiting on any more.
 *
 * `readProcessState` is REQUIRED — no default, no optional: a default would be a
 * knob, and the platform read it stands in for belongs to a composition root
 * (`osfacts-client`), never to this package. Its error channel is on this
 * Effect, so a read that could not complete fails the ladder rather than
 * degrading to the graceful window (see the module doc).
 */
export function reapHolder(
  pid: number,
  readProcessState: ReadProcessState,
  opts: ReapHolderOptions = {},
): Effect.Effect<ReapOutcome, OsfactsClientError> {
  return Effect.gen(function* () {
    const startedAt = Date.now();
    const waited = (): number => Date.now() - startedAt;

    // ONE observation, at the moment of reap — not a poller. A failed read
    // travels the error channel (the endpoint reports `dead` and rethrows);
    // `undefined` (pid gone) falls through and the KILL leg reports it.
    const stopped = isStoppedState(yield* readProcessState(pid));

    // Step 1 is for a daemon that HAS a shutdown handler to run. A stopped
    // holder provably does not (its SIGTERM would be queued, never delivered),
    // so the graceful window is skipped and SIGKILL — which IS delivered to a
    // stopped process — takes it now.
    if (!stopped) {
      yield* Effect.sync(() => signalIgnoringRace(pid, "SIGTERM"));
      if (
        yield* waitForPidGone(pid, {
          timeoutMs: opts.termCeilingMs ?? REAP_TERM_CEILING_MS,
          intervalMs: opts.intervalMs,
        })
      ) {
        return { kind: "reaped", endedBy: "SIGTERM", waitedMs: waited() };
      }
    }

    // The ONE KILL leg — reached immediately on the stopped path, past the
    // graceful deadline otherwise. `skipped` records WHY the graceful leg was
    // skipped, on BOTH outcomes, so the endpoint's survivor message and the
    // takeover's observation line read the same fact.
    const skipped = stopped ? { reason: "stopped" as const } : {};
    yield* Effect.sync(() => signalIgnoringRace(pid, "SIGKILL"));
    if (
      yield* waitForPidGone(pid, {
        timeoutMs: opts.killCeilingMs ?? REAP_KILL_CEILING_MS,
        intervalMs: opts.intervalMs,
      })
    ) {
      return {
        kind: "reaped",
        endedBy: "SIGKILL",
        waitedMs: waited(),
        ...skipped,
      };
    }

    return { kind: "survived", waitedMs: waited(), ...skipped };
  });
}
