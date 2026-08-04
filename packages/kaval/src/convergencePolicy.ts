/**
 * kaval's CONVERGENCE POLICY — who kaval is, and what a supervisor of kaval
 * should do when the resident daemon is not that.
 *
 * ## Why it lives here and not in the supervisor that consumes it
 *
 * It used to live in `@kolu/padi`'s `ptyHost/index.ts`, for the only reason that
 * mattered then: padi was the ONLY supervisor of kaval. juspay/kolu#2101 ends
 * that — `kaval --stdio` now converges its own durable daemon before it relays a
 * byte, so there are two supervisors and they must not disagree about which
 * contract version is current or what a build mismatch means.
 *
 * Every field is a fact about **kaval** (its `PTY_HOST_CONTRACT_VERSION`, its
 * baked staleKey, that a skew is recycled and a build mismatch is a human nudge),
 * so the declaration belongs beside the daemon it declares. padi imports it.
 *
 * ## The two response policies, and why they differ
 *
 * - **Contract skew → `recycle`.** kaval is NOT drainable: it has no drain verb
 *   that persists state, because the state IS the live PTYs. A skewed kaval is
 *   replaced outright, which costs those PTYs — acceptable only because a skew
 *   means the supervisor cannot speak to it at all.
 * - **Build mismatch → `nudge-human`.** A same-contract kaval running older code
 *   is perfectly usable. Recycling it to pick up a new build would kill live PTYs
 *   for no wire-level reason, so the kit reports the mismatch as an outcome and
 *   takes no action; "update available" stays a human decision.
 *
 * Being non-drainable, kaval CANNOT spell a drain policy or a `drainBudget`
 * (Pin 1 — a compile error). No inert fence is constructed.
 */

import {
  type ConvergencePolicy,
  daemonBuild,
} from "@kolu/surface-daemon-supervisor";
import { currentPtyHostIdentity } from "./buildId.ts";
import { PTY_HOST_CONTRACT_VERSION } from "./ptyHostSurface.ts";

export function kavalConvergencePolicy(): ConvergencePolicy<"not-drainable"> {
  return {
    capability: "not-drainable",
    baked: {
      contractVersion: PTY_HOST_CONTRACT_VERSION,
      build: daemonBuild(currentPtyHostIdentity().staleKey),
    },
    onContractSkew: { kind: "recycle" },
    onBuildMismatch: { kind: "nudge-human" },
  };
}
