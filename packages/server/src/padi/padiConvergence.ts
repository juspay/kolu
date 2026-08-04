/**
 * padi's CONVERGENCE declaration into the shared daemon-convergence kit
 * (`@kolu/surface-daemon-supervisor`'s `converge` / `convergeAdmit`), plus the drain
 * plumbing the declaration and the "restart" verb both reach for.
 *
 * This is the fourth concern carved out of {@link ./padiBinding.ts} (W4 ledger L6):
 * the binder proper is the driver + the reconnect-mirror session + `ensurePadiBinding`;
 * THIS file is padi's contract-skew POLICY and the FROZEN-control-core probe/drain that
 * enact it.
 *
 * What this file owns:
 *   - {@link drainViaControlCore} — the endpoint arm's drain, built on the framework's
 *     {@link drainAndAwaitExit}.
 *
 * What it no longer owns, and RE-EXPORTS instead: `padiConvergencePolicy` /
 * `padiConvergencePolicyForBinding`. Those moved to `@kolu/padi/convergence-policy`
 * (juspay/kolu#2101) the moment padi grew a SECOND supervisor — `padi --stdio`
 * converges its own durable daemon before it relays — because a policy two
 * supervisors must agree on cannot live inside one of them. Every import path
 * here is unchanged; only the source of truth moved.
 *
 * Framework anomalies ride the wire AS-IS ({@link PadiConvergence} re-derives the
 * framework union shape + app-only `link-failed`). There is no converter.
 */

import {
  MAX_BUILD_DRAINS_PER_INSTANCE,
  padiConvergencePolicy,
  padiConvergencePolicyForBinding,
} from "@kolu/padi/convergence-policy";
import type { PadiDaemonClient } from "@kolu/padi/dial";
import {
  drainAndAwaitExit,
  drainRejectionSuffix,
} from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";

// Re-export the framework drain skeleton so the remote arm's existing import path
// (`./padiConvergence`) keeps working; the implementation lives in the supervisor.
export { drainAndAwaitExit };

// padi's own declaration of who it is and how it converges, re-exported so both
// binding arms keep importing it from here while the source of truth sits beside
// the daemon it describes (`@kolu/padi/convergence-policy`).
export {
  MAX_BUILD_DRAINS_PER_INSTANCE,
  padiConvergencePolicy,
  padiConvergencePolicyForBinding,
};

/** How long `drainViaControlCore` waits for the socket to CLOSE after the drain RPC
 *  rejects, before treating the rejection as a real failure. */
export const PADI_DRAIN_TEARDOWN_CEILING_MS = 2000;

/** The minimal connection shape the drain plumbing needs. */
export type DrainableConn = {
  client: PadiDaemonClient;
  onClose: (cb: () => void) => void;
};

export { drainRejectionSuffix };

/** The endpoint arm's exit ORACLE: the daemon's socket closing.
 *
 *  `onClose` is a synchronous, fire-at-most-once subscription the endpoint's own
 *  connection owns, so this is a plain `Effect.callback` with no finalizer to
 *  register — there is no unsubscribe to perform and nothing to leak. It never
 *  fails, which is the F3 contract (`Effect<void>`): a link blip is not an exit,
 *  and the ceiling — not this oracle — is what decides that the drain did not
 *  take. When the ceiling wins, the framework INTERRUPTS this effect; the
 *  AbortSignal it used to be handed existed only to say that, and interruption
 *  says it unconditionally. */
function awaitSocketClose(conn: DrainableConn): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    conn.onClose(() => resume(Effect.void));
  });
}

/**
 * DRAIN a padi over the FROZEN control core, then confirm it actually exited by
 * the SOCKET CLOSING within the teardown window — the endpoint/local arm's use of
 * the framework {@link drainAndAwaitExit}. FAILS when the drain does not take.
 */
export function drainViaControlCore(
  conn: DrainableConn,
): Effect.Effect<void, Error> {
  return Effect.flatMap(
    drainAndAwaitExit(
      conn.client.control.surface.core.drain(),
      awaitSocketClose(conn),
      { ceilingMs: PADI_DRAIN_TEARDOWN_CEILING_MS },
    ),
    ({ took, drainRejection }) =>
      took
        ? Effect.void
        : Effect.fail(
            new Error(
              `padi drain did not complete — its socket did not close within ${PADI_DRAIN_TEARDOWN_CEILING_MS}ms (padi did not exit)` +
                drainRejectionSuffix(drainRejection),
            ),
          ),
  );
}
