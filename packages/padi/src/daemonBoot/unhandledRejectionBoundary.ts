/**
 * padi's process-level unhandled-rejection BACKSTOP — loud, never fatal.
 *
 * This is a DELIBERATE divergence from kolu-server's `unhandledRejection`
 * policy (`packages/server/src/index.ts`), which is fatal-by-design
 * ("a floating promise is as corrupting as a sync throw; fix the source,
 * don't soften the net; the supervisor restarts clean"). padi takes the
 * opposite stance for one reason: padi is the LONG-LIVED workspace daemon
 * that holds the live session + the re-served surface, and it MIRRORS its
 * kaval over the same reconnect-teardown machinery that produced the
 * tracked #1719 float. A benign transport-teardown `AbortError` floating up
 * and killing padi — dropping the whole workspace — is a catastrophic
 * overreaction to teardown noise. So an unidentified float becomes a
 * diagnosable, greppable LOG LINE and padi keeps serving, rather than a
 * dead daemon.
 *
 * THE TENSION, stated honestly (this is a backstop, NOT a fix): a
 * never-fatal global boundary can MASK a genuinely-new bug — a real
 * corrupting float now survives instead of crashing loudly. Two mitigations
 * keep it honest:
 *   1. The log is LOUD and GREPPABLE — every catch carries
 *      {@link PADI_UNHANDLED_REJECTION_MARKER}, so an operator (or a CI
 *      grep) finds every float the backstop swallowed the crash of. It is
 *      surfaced, never silenced — the caught-error doctrine
 *      (`.agency/code-police.md` → `caught-error-must-not-collapse-to-empty`)
 *      demands the failure be distinguishable, and a marked ERROR line is.
 *   2. IDENTIFIED floats are still fixed at their SOURCE (the #1719 stdio
 *      teardown mechanism is owned/typed-cancelled at the link + pump). The
 *      boundary catches only the UNIDENTIFIED future float — it is the net
 *      under the fix, not a substitute for it.
 *
 * Scope is `unhandledRejection` ONLY. A synchronous `uncaughtException` is a
 * different, more-corrupting class (a torn call stack, not an abandoned
 * promise) and keeps Node's default fail-fast — padi installs no soft net
 * for it.
 */

import type { Logger } from "../log.ts";

/** The greppable marker every backstop-caught float carries. Grep CI logs /
 *  the rolled padi log for this to enumerate every unidentified float the
 *  boundary kept padi alive through — each one is a missing source-level
 *  error boundary to hunt down, not an accepted cost. */
export const PADI_UNHANDLED_REJECTION_MARKER =
  "padi-unhandled-rejection-boundary";

/** A health sink the boundary notifies WHERE REACHABLE. The global handler
 *  installs at the very top of daemon boot — before the padiSurface (and its
 *  `status` cell) exists — so surfacing is best-effort: a sink registered
 *  once the surface is up receives later floats; until then the loud log IS
 *  the surface. Never throws out of the boundary (a sink that throws would
 *  itself float). */
export interface BoundaryFloat {
  /** The rejection reason, verbatim (an `Error` or whatever was thrown). */
  reason: unknown;
  /** Best-effort message pulled off `reason` for a compact health readout. */
  message: string;
}

let healthSink: ((float: BoundaryFloat) => void) | undefined;

/** Register (or clear, with `undefined`) the health sink the boundary
 *  notifies for each caught float. Idempotent; the last registration wins.
 *  Wired once the padiSurface is reachable; safe to leave unset (log-only). */
export function registerBoundaryHealthSink(
  sink: ((float: BoundaryFloat) => void) | undefined,
): void {
  healthSink = sink;
}

let installed = false;

/** Install padi's loud-not-fatal `unhandledRejection` backstop, once per
 *  process. Idempotent — a second call no-ops (multiple boot paths must not
 *  stack listeners).
 *
 *  Installed from the PROCESS entrypoint (`bin.ts`), for the durable-daemon
 *  branch only — NOT from `runPadiDaemon`, because `daemonMain.test.ts` boots
 *  `runPadiDaemon` in-process and a global handler there would suppress
 *  vitest's own unhandled-rejection detection. Pass the `./log.ts` `log`
 *  Proxy: it forwards to whatever logger is active AT FLOAT TIME, so by the
 *  time a float can occur `runPadiDaemon`'s `configureDaemonLog()` has swapped
 *  it to the rolled-file + stderr multistream and the marked ERROR is captured
 *  durably. */
export function installUnhandledRejectionBoundary(log: Logger): void {
  if (installed) return;
  installed = true;
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    // LOUD: a marked ERROR carrying the full reason (pino serializes an
    // `Error` under `err` with its stack). NEVER `process.exit` — padi keeps
    // serving. NEVER silently swallowed — this line IS the surface.
    log.error(
      {
        marker: PADI_UNHANDLED_REJECTION_MARKER,
        err: reason instanceof Error ? reason : undefined,
        reason: reason instanceof Error ? undefined : reason,
      },
      `${PADI_UNHANDLED_REJECTION_MARKER}: a background task floated a rejection — padi SURVIVES (loud backstop, not a fix). Hunt the missing source-level error boundary. reason=${message}`,
    );
    // Surface to health where reachable (best-effort; a sink throwing must
    // not itself float, so guard it).
    try {
      healthSink?.({ reason, message });
    } catch (sinkErr) {
      log.error(
        { marker: PADI_UNHANDLED_REJECTION_MARKER, err: sinkErr },
        `${PADI_UNHANDLED_REJECTION_MARKER}: health sink threw while reporting a float (ignored)`,
      );
    }
  });
}

/** Test-only reset of the install latch, so a unit test can install a fresh
 *  boundary against a fake logger and remove it. NOT part of the daemon
 *  runtime path. */
export function __resetUnhandledRejectionBoundaryForTest(): void {
  installed = false;
  healthSink = undefined;
}
