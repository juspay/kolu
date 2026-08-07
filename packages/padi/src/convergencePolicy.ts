/**
 * padi's CONVERGENCE POLICY — who padi is, and what a supervisor of padi should
 * do when the resident daemon is not that.
 *
 * ## Why it lives in `@kolu/padi` and not in the supervisor that consumes it
 *
 * It used to live in kolu-server (`padi/padiConvergence.ts`), for the only
 * reason that mattered at the time: kolu-server was the ONLY supervisor of padi.
 * juspay/kolu#2101 ends that — `padi --stdio` now converges its own durable
 * daemon before it relays a byte, so there are two supervisors and they must not
 * disagree about padi's contract version, its drain semantics, or how many build
 * drains an instance may spend.
 *
 * Under the volatility lens the home is unambiguous: every field here is a fact
 * about **padi** (its `PADI_SURFACE_VERSION`, that it is drainable, that a
 * contract skew means "drain a newer one else refuse", that a build mismatch
 * means "drain and replace"). None is a fact about kolu-server, which merely
 * happened to be first to ask. The volatility encapsulated is padi's own — it
 * changes when padi changes — so the declaration belongs beside the thing it
 * declares, and the supervisors depend on it rather than each restating it.
 *
 * kolu-server's `padi/padiConvergence.ts` re-exports these, so every existing
 * import path is unchanged; what moved is the source of truth, not the API.
 */

import {
  type ConvergencePolicy,
  daemonBuild,
} from "@kolu/surface-daemon-supervisor";
import { PADI_SURFACE_VERSION } from "./surface.ts";

/**
 * How many BUILD-axis drains one supervisor instance may spend on one padi
 * lineage before it gives up and rides the resident with a standing anomaly.
 *
 * Shared by every arm (local endpoint, ssh binder, and padi's own stdio front).
 * The local arm was once a once-per-boot boolean (≡ 1) and the remote arm used
 * 3; unified at 3 so a same-instance flap still terminates while a genuine
 * upgrade has room for the drain → respawn → re-handshake round trip.
 */
export const MAX_BUILD_DRAINS_PER_INSTANCE = 3;

type PadiConvergencePolicyInputs = {
  contractVersion: string;
  binderBuildId: string;
  maxBuildDrainsPerInstance: number;
};

/** Internal policy factory shared by every arm. A test dependency seam supplies
 *  its own values; production reaches this only with baked constants. */
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
 * padi's full convergence policy for a given supervisor build id. Drainable;
 * budget survives adopts; `onGiveUp: "adopt-stale"` so a flapping link rides the
 * resident with a standing anomaly rather than going dark. Cap-gates make
 * `drainBudget` unspellable on a not-drainable policy (kaval never constructs
 * one).
 */
export function padiConvergencePolicy(
  binderBuildId: string,
): ConvergencePolicy<"drainable"> {
  return padiConvergencePolicyForBinding({
    contractVersion: PADI_SURFACE_VERSION,
    binderBuildId,
    maxBuildDrainsPerInstance: MAX_BUILD_DRAINS_PER_INSTANCE,
  });
}
