/**
 * The daemon-side disposition of an OWNED surface-runtime fault: log it WHOLE,
 * run the daemon's last rites, and end the tenure through the ordinary shutdown
 * machinery with a non-zero exit code.
 *
 * One home so kaval and padi (and drishti's daemon) cannot drift on a decision
 * this consequential, and so the argument for it is written down once:
 *
 * **A `runtime.done` rejection is structural wiring death.** After juspay/kolu#2101
 * G1 every fallible PERIODIC thing was moved off that channel — a poll cell's read
 * failure (T+0 seed included), a scan step's throw, a recompute's throw are all
 * cell-local now. What is left is the wiring itself: a connector's `install`
 * throwing, a builder's one-shot guard, a finalizer faulting during teardown. None
 * of those heal by waiting, and none of them are survivable by the members that
 * depend on them. See the audit table on `SurfaceRuntimeHandle.done` in
 * `@kolu/surface` — that table is what makes this fatal disposition safe.
 *
 * **Why fatal beats "log and keep serving".** The deploy-#2 incident (#2101) is the
 * receipt: a padi whose runtime had faulted kept its gate and its socket, answered
 * RPCs, reported "connected" — and served a dead cell for the rest of the process's
 * life. `done` was already settled, so every FUTURE fault was unobservable too. The
 * repo's fail-fast philosophy says a dead runtime should die loudly: the supervisor
 * respawns, session-restore recovers in ~2s, and an operator reads a crash instead
 * of guessing at a half-death.
 *
 * **Why through the shutdown machinery, not `process.exit`.** The exit must not
 * skip the finalizers: the listener closes, the gate releases, and the daemon's own
 * last rites (padi's final session capture) run first — so the respawn finds a clean
 * rendezvous rather than a stale socket and a gate held by a dead pid.
 *
 * **The line against #1792.** padi's `unhandledRejectionBoundary` stays loud-not-
 * fatal, and that is not a contradiction: it catches UNOWNED FLOATS — teardown
 * noise from a reconnect nobody is awaiting, whose worst case is a misleading log
 * line. This is the OWNED channel — a fault the runtime deliberately hands its
 * owner, whose worst case is a zombie daemon. Unowned float ⇒ log; owned fault ⇒
 * die. Both files say so.
 */

import type { Logger } from "./logger.ts";

/** The greppable marker every runtime-fault exit carries — one grep over a host's
 *  daemon logs enumerates every daemon that died this way. */
export const DAEMON_RUNTIME_FAULT_MARKER = "daemon-runtime-fault";

export interface RuntimeFaultExitOptions {
  /** The served surface runtime's `done` — rejects on an owned fault, resolves on
   *  a clean `close()`. Observed IMMEDIATELY (at the call), so an owned fault can
   *  never float to the process boundary and be mistaken for #1792 teardown noise. */
  done: Promise<void>;
  log: Logger;
  /** What faulted, in the daemon's own words ("padi surface runtime") — this is
   *  the operator's first clue, so name the runtime, not the package. */
  subject: string;
  /** The daemon's LAST RITES, run before the shutdown is triggered — padi captures
   *  its final session here so the respawn restores it. Runs on the fault path
   *  only. A throw from it is logged and does NOT stop the exit: a failed capture
   *  must never resurrect the zombie this whole path exists to kill. */
  lastRites?: (err: unknown) => void;
}

/** Wire a surface runtime's `done` to a daemon exit, and hand back the
 *  `AbortSignal` to pass as `DaemonSpec.faultSignal`. The daemon then ends with
 *  `{ kind: "shutdown", reason: "runtime-fault" }`, which `daemonExitCode` scores
 *  non-zero — the supervisor's only channel for "that was a crash, not a stop". */
export function armRuntimeFaultExit(
  opts: RuntimeFaultExitOptions,
): AbortSignal {
  const { done, log, subject, lastRites } = opts;
  const controller = new AbortController();
  done.catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    // The WHOLE error, not its message: pino serializes an `Error` under `err`
    // with its stack, and the incident's log line — message-only — is precisely
    // what left the faulting cell unidentifiable. Same split as padi's
    // unhandled-rejection boundary, so both lines read the same way.
    log.error(
      {
        marker: DAEMON_RUNTIME_FAULT_MARKER,
        err: err instanceof Error ? err : undefined,
        reason: err instanceof Error ? undefined : err,
      },
      `FATAL: ${subject} faulted — structural wiring death, not a transient. Shutting down (socket + gate released, last rites run) with a non-zero exit so the supervisor respawns. reason=${message}`,
    );
    try {
      lastRites?.(err);
    } catch (riteErr) {
      log.error(
        { marker: DAEMON_RUNTIME_FAULT_MARKER, err: riteErr },
        `${DAEMON_RUNTIME_FAULT_MARKER}: last rites threw while exiting on a runtime fault — exiting anyway`,
      );
    }
    controller.abort();
  });
  return controller.signal;
}
