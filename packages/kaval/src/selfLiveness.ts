/**
 * kaval's SELF-LIVENESS probe (juspay/kolu#2101 N2) — the daemon proves it can
 * serve, or it exits.
 *
 * ## Why a daemon must dial itself
 *
 * Every guard this campaign built covers a FAULT (G2 exits the daemon loudly
 * when its runtime dies) or a client-visible SILENCE (the H3/K1 deadlines, the
 * J1 epochs). The #2101 field incident tripped none of them: a serving layer
 * that HANGS without faulting rejects nothing, closes nothing, and times nothing
 * out in-process. From the inside the daemon looks perfectly healthy — because
 * from the inside, nothing has happened. The only observer that can tell the
 * difference is one standing where a client stands, and the cheapest such
 * observer is the daemon itself, over its own socket, through its own listener,
 * its own codec, and its own handler dispatch.
 *
 * This is the BELT to N1's braces. N1 (padi's supervision) is the general fix
 * and covers more; this fires even when no padi is watching, and it converts
 * "comatose forever" — a state no guard in the system handles — into "dead
 * loudly", which every guard already handles. The field's late receipts sharpen
 * the point: a delayed dial against that wedged socket eventually returned binary
 * garbage before the transport closed. A self-probe classifies that instantly.
 *
 * ## Timer choice — node timers, not Effect's Clock
 *
 * The ruling `@kolu/heap-diag` wrote down, for the same two reasons, restated
 * here so the next sweep does not re-litigate it:
 *
 *  1. **The timer must be `unref`'d.** A liveness instrument must never be the
 *     thing keeping an otherwise-drained daemon alive. Effect 4's default `Clock`
 *     sleeps on a plain, REF'd `setTimeout` (`effect/src/internal/effect.ts`,
 *     `ClockImpl.sleepMillis`) and exposes no unref, so `Effect.sleep` /
 *     `Schedule.fixed` cannot express this timer without a bespoke Clock service
 *     — and a liveness probe is not worth inventing one for.
 *  2. **Chained `setTimeout`, not `setInterval`.** A probe against a wedged
 *     listener spends its whole deadline, and overlapping probes would count one
 *     wedge several times. The next tick is scheduled from the previous one's
 *     COMPLETION, so overlap is unspellable.
 *
 * ## Suspension: inert while stopped, fresh budget on resume
 *
 * A suspended process does not tick — a stopped machine cannot spuriously fail
 * its own probe, because nothing runs. The hazard is the FIRST probe after
 * resume, taken against a network/socket layer the kernel has just put back
 * together, on a budget the pre-suspend ticks may have partly spent.
 *
 * So the resume is DETECTED rather than assumed: each tick records when it is
 * due, and a tick that fires more than {@link SUSPENSION_GAP_MS} late did not
 * merely lose a scheduling slot — the wall clock jumped, i.e. the process was
 * stopped in between. That tick clears the ledger before recording anything, so
 * the first post-resume probe starts from a full budget. This is deliberately
 * generous: the failure this module exists to catch is CAUSED by resume, and it
 * will re-earn its streak in 30 s if it is real.
 *
 * ## Why nothing here is an unbounded wait or retry
 *
 * The loop is a poll, not a retry: fixed cadence, identical bounded work, no
 * accumulation outside the ledger. The dial and the read are both bounded by
 * {@link SELF_PROBE_DEADLINE_MS}, and the number of failures is bounded by the
 * ledger's ceiling, past which the daemon EXITS rather than keeps trying.
 */

import type { Logger } from "@kolu/surface-daemon";
import { makeFailureLedger } from "@kolu/surface/failure-ledger";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { Effect } from "effect";
import { kavalDaemonGroup } from "./daemonSurface.ts";
import { ptyHostClientOver } from "./ptyHostClient.ts";

/** Cadence of the self-probe — the same 10 s family padi's inventory poll uses,
 *  so an operator reading two daemons' journals is reading one clock. Coarse
 *  enough that a probe per tick over a local unix socket is free; live enough
 *  that a wedge is a sub-minute fact rather than a next-morning one. */
export const SELF_PROBE_INTERVAL_MS = 10_000;

/** How long one self-probe may take. Half the cadence, on the SAME derivation
 *  padi's `PROBE_TIMEOUT_MS` carries: a budget past half the interval would let
 *  one tick still be running when the next is due, and a daemon that cannot
 *  answer its own cheapest read-only verb through its own listener in five
 *  seconds is not busy — the work is a constant lookup, not a scan. */
export const SELF_PROBE_DEADLINE_MS = SELF_PROBE_INTERVAL_MS / 2;

/** A tick this much past its due time means the WALL CLOCK jumped — the process
 *  was suspended — not that the event loop was busy. Two whole cadences: a
 *  loaded box delays a timer by milliseconds to a second, never by twenty.
 *  See the module doc's suspension section for what the detection is FOR. */
export const SUSPENSION_GAP_MS = SELF_PROBE_INTERVAL_MS * 2;

/** Did this tick fire so far past its due time that the process must have been
 *  STOPPED in between? Exported so the resume rule is falsifiable on its own,
 *  without a suspended machine to test on. */
export function isResumeAfterSuspension(
  lateByMs: number,
  gapMs = SUSPENSION_GAP_MS,
): boolean {
  return lateByMs > gapMs;
}

/**
 * The self-probe budget. ONE class — and it still rides
 * `@kolu/surface/failure-ledger` rather than a bare integer, deliberately.
 *
 * A single-class budget does not NEED the ledger's anti-conflation law: with one
 * increment and one ceiling the disease is unspellable, and
 * `@kolu/surface-remote`'s hand-rolled `makeStepBudget` is the ratified example
 * of that shape staying hand-rolled. What the ledger buys HERE is the other half
 * of its contract: the give-up decision arrives as a `FailureVerdict` carrying
 * the run that tripped and the ceiling it tripped against, so the exit's log line
 * is built from the verdict rather than from a counter the message has to
 * describe correctly by review. This daemon's last words before a non-zero exit
 * are not a place to re-derive a number.
 *
 * **K = 3.** One failed self-probe is not evidence — a probe crossing its own
 * listener during a `killAll` storm or a GC pause can lose a 5 s race honestly.
 * Three CONSECUTIVE failures is ≥30 s in which the daemon could not answer its
 * own cheapest verb through its own socket, three times, with a fresh dial each
 * time. Nothing recoverable looks like that. It is also the same 3 padi's
 * supervision uses for the same fact observed from outside, so the two never
 * disagree about how much silence is a coma; the difference is only who acts.
 */
export const SELF_PROBE_CEILING = 3;

/** Dial our OWN socket and perform the cheapest complete round-trip there is:
 *  `system.version`, a constant read that still crosses the listener, the codec,
 *  the RPC dispatch and one handler. Bounded end to end; the link is disposed on
 *  every path (its `dispose()` is the only thing that frees the protocol fibers,
 *  so a leaked one per tick would be its own slow death). */
function selfProbe(socketPath: string): Effect.Effect<void, unknown> {
  const bounded = <A, E>(
    read: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | Error> =>
    Effect.timeoutOrElse(read, {
      duration: SELF_PROBE_DEADLINE_MS,
      orElse: () =>
        Effect.fail(
          new Error(`self-probe timed out after ${SELF_PROBE_DEADLINE_MS}ms`),
        ),
    });
  return Effect.scoped(
    Effect.flatMap(
      Effect.acquireRelease(
        bounded(
          Effect.promise(() =>
            unixSocketLink({ group: kavalDaemonGroup, socketPath }),
          ),
        ),
        (link) => Effect.promise(() => link.dispose()),
      ),
      (link) =>
        Effect.asVoid(
          bounded(ptyHostClientOver(link.dispatch).surface.system.version({})),
        ),
    ),
  );
}

export interface KavalSelfLivenessOptions {
  /** The socket this daemon is serving — the address it dials itself at. */
  readonly socketPath: string;
  readonly log: Logger;
  /** Run when the budget is exhausted. Wired to the G2 fault arm: the daemon
   *  ends its tenure through the ordinary shutdown machinery with a non-zero
   *  exit, so its padi respawns it. Called AT MOST ONCE. */
  readonly onExhausted: () => void;
  /** Poll cadence override, in ms — a TEST seam (like `daemonMain`'s
   *  `anchorPollMs`); production omits it. */
  readonly pollMs?: number;
}

/** Start the self-liveness loop. Returns a stop function (idempotent) — the
 *  DISARM the shutdown path calls, so a daemon that is deliberately closing its
 *  listener can never race its own clean exit into a fault exit. */
export function startKavalSelfLiveness(
  opts: KavalSelfLivenessOptions,
): () => void {
  const ledger = makeFailureLedger({
    selfProbe: { ceiling: SELF_PROBE_CEILING },
  });
  const everyMs = opts.pollMs ?? SELF_PROBE_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dueAt = Date.now() + everyMs;

  const schedule = (): void => {
    if (stopped) return;
    dueAt = Date.now() + everyMs;
    timer = setTimeout(() => void tick(), everyMs);
    timer.unref?.();
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const lateBy = Date.now() - dueAt;
    if (isResumeAfterSuspension(lateBy, everyMs * 2)) {
      ledger.success();
      opts.log.info(
        { lateByMs: lateBy },
        "kaval self-liveness: the clock jumped (the process was suspended) — self-probe budget reset",
      );
    }
    const failure = await Effect.runPromise(
      Effect.match(selfProbe(opts.socketPath), {
        onSuccess: () => undefined,
        onFailure: (err: unknown) => err ?? new Error("self-probe failed"),
      }),
      // The dial rides `Effect.promise`, so a connect rejection is a DEFECT and
      // never reaches `onFailure`. A daemon that cannot dial its own listening
      // socket is exactly the fact this probe exists to find, so both channels
      // land on the same value.
    ).catch((err: unknown) => err ?? new Error("self-probe defect"));

    if (stopped) return;
    if (failure === undefined) {
      ledger.success();
      schedule();
      return;
    }
    const verdict = ledger.record("selfProbe");
    if (!verdict.exhausted) {
      // Per-tick silence, K3's idiom: one lost race is not news, and a line per
      // tick would bury the one that is.
      opts.log.debug(
        { err: failure, run: verdict.run, ceiling: verdict.ceiling },
        "kaval self-liveness: self-probe failed",
      );
      schedule();
      return;
    }
    stopped = true;
    opts.log.error(
      { err: failure, run: verdict.run, ceiling: verdict.ceiling },
      `FATAL: kaval self-liveness — ${verdict.run} consecutive self-probes failed (ceiling ${verdict.ceiling}). This daemon accepts connections and cannot serve them; exiting non-zero so its padi respawns it, rather than staying comatose.`,
    );
    opts.onExhausted();
  };

  schedule();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
