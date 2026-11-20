import { PADI_SURFACE_VERSION } from "@kolu/padi-client/surface";
import {
  type ConvergencePolicy,
  daemonBuild,
} from "@kolu/surface-daemon-supervisor";

/** How many BUILD-axis drains one supervisor instance may spend on one padi
 *  lineage before it rides the resident with a standing anomaly. Shared by
 *  every arm (local endpoint, ssh binder, padi's own stdio front). */
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

/** padi's full convergence policy for a given supervisor build id. Drainable;
 *  the budget survives adopts, and `onGiveUp: "adopt-stale"` makes a flapping
 *  link ride the resident with a standing anomaly rather than go dark. */
export function padiConvergencePolicy(
  binderBuildId: string,
): ConvergencePolicy<"drainable"> {
  return padiConvergencePolicyForBinding({
    contractVersion: PADI_SURFACE_VERSION,
    binderBuildId,
    maxBuildDrainsPerInstance: MAX_BUILD_DRAINS_PER_INSTANCE,
  });
}
