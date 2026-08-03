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
 *   - {@link padiConvergencePolicy} — padi's declared policy (drainable; baked identity;
 *     drain-newer-else-refuse on contract skew; drain-and-replace on build mismatch;
 *     Cap-gated drainBudget). ONE object for BOTH arms.
 *   - {@link drainViaControlCore} — the endpoint arm's drain, built on the framework's
 *     {@link drainAndAwaitExit}.
 *
 * Framework anomalies ride the wire AS-IS ({@link PadiConvergence} re-derives the
 * framework union shape + app-only `link-failed`). There is no converter.
 */

import type { PadiDaemonClient } from "@kolu/padi/dial";
import { PADI_SURFACE_VERSION } from "@kolu/padi/surface";
import {
  type ConvergencePolicy,
  daemonBuild,
  drainAndAwaitExit,
  drainRejectionSuffix,
} from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";

// Re-export the framework drain skeleton so the remote arm's existing import path
// (`./padiConvergence`) keeps working; the implementation lives in the supervisor.
export { drainAndAwaitExit };

/** How long `drainViaControlCore` waits for the socket to CLOSE after the drain RPC
 *  rejects, before treating the rejection as a real failure. */
export const PADI_DRAIN_TEARDOWN_CEILING_MS = 2000;

type PadiConvergencePolicyInputs = {
  contractVersion: string;
  binderBuildId: string;
  maxBuildDrainsPerInstance: number;
};

/** Internal policy factory shared by the local and remote binding arms. The
 * remote arm supplies values from its test dependency seam; production still
 * reaches this only with baked constants. */
export function padiConvergencePolicyForBinding(
  inputs: PadiConvergencePolicyInputs,
) {
  return {
    capability: "drainable",
    baked: {
      contractVersion: inputs.contractVersion,
      build: daemonBuild(inputs.binderBuildId),
    },
    onContractSkew: { kind: "drain-newer-else-refuse" },
    onBuildMismatch: { kind: "drain-and-replace" },
    drainBudget: {
      maxAttempts: inputs.maxBuildDrainsPerInstance,
      onGiveUp: "adopt-stale",
    },
  } as const satisfies ConvergencePolicy<"drainable">;
}

/**
 * padi's full convergence policy for a given binder build id. Drainable; budget
 * survives adopts; `onGiveUp: "adopt-stale"` so a flapping link rides the resident
 * with a standing anomaly rather than going dark. Cap-gates make `drainBudget`
 * unspellable on a not-drainable policy (kaval never constructs one).
 */
export function padiConvergencePolicy(
  binderBuildId: string,
): ConvergencePolicy<"drainable"> {
  return padiConvergencePolicyForBinding({
    contractVersion: PADI_SURFACE_VERSION,
    binderBuildId,
    // Shared by local + ssh arms. Local used to be a once-per-boot boolean (≡ 1);
    // remote used 3. Unified at 3 so a same-instance flap still terminates, and the
    // budget's cross-supervisor memory survives adopts on both arms.
    maxBuildDrainsPerInstance: 3,
  });
}

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
