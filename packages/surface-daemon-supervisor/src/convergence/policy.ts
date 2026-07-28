/**
 * Convergence POLICY — the consumer's entire convergence surface: who I am + how I
 * converge, stated once, read by both enactments (`converge` for endpoints,
 * `convergeAdmit` for connectors).
 *
 * Pin 1 (drain capability is typed, make-illegal-unrepresentable): a `drain-and-replace`
 * / `drain-newer-else-refuse` arm PERSISTS the daemon (graceful drain, its children
 * survive) rather than killing it — which requires the daemon to actually expose a drain
 * verb on its handshake. So the drain arms AND `drainBudget` exist ONLY when the
 * `DrainCapability` is `"drainable"`. A drainless daemon (kaval) therefore CANNOT spell
 * a budget or a drain policy: the fields are `never` and the declaration is a compile
 * error, not a runtime surprise (and never an inert fence constructed for type-filling).
 */

import type { ConvergenceIdentity } from "@kolu/surface-daemon";

/** Whether a daemon's handshake exposes a `drain` verb — the type-level gate on the
 *  drain policy arms and the budget. */
export type DrainCapability = "drainable" | "not-drainable";

/** What to do when the running daemon is a CONTRACT skew (incompatible wire version):
 *   - `recycle` — KILL + respawn (kaval: a skewed daemon can't serve the new supervisor,
 *     so it must be replaced; its PTYs die, unavoidable at a wire break). Needs no drain.
 *   - `refuse` — leave the survivor standing + degraded, never touch it (the #1313
 *     never-recycle-a-running-daemon inversion).
 *   - `drain-newer-else-refuse` — ORDERED (padi): a strictly-newer supervisor DRAINS the
 *     survivor (persist + exit; its children survive) then spawns its own; an older one
 *     refuses (the anti-livelock monotonicity). Drain-capable only. */
export type ContractSkewPolicy<Cap extends DrainCapability> =
  | { readonly kind: "recycle" }
  | { readonly kind: "refuse" }
  | (Cap extends "drainable"
      ? { readonly kind: "drain-newer-else-refuse" }
      : never);

/** What to do when the running daemon is CONTRACT-COMPATIBLE but a DIFFERENT (or absent)
 *  build — a same-contract closure change:
 *   - `nudge-human` — take NO supervisor action; RETURN the mismatch as an outcome the
 *     caller surfaces (kaval: acting would recycle → kill PTYs, so a human decides via
 *     the currency nudge). The kit detects; the caller enacts what it owns.
 *   - `drain-and-replace` — DRAIN the survivor (budgeted) and spawn our own build (padi:
 *     drain is cheap, its kaval + PTYs survive). Drain-capable only. Store hashes don't
 *     order, so this is match-vs-mismatch, never newer/older. */
export type BuildMismatchPolicy<Cap extends DrainCapability> =
  | { readonly kind: "nudge-human" }
  | (Cap extends "drainable" ? { readonly kind: "drain-and-replace" } : never);

/** Cap-gated budget: how many times this supervisor may drain a lineage before giving
 *  up, and what to do then. State lives inside the supervisor (per boot), survives
 *  adopts, and is owned by the framework — consumers declare this data, never a budget
 *  object. Unspellable on a not-drainable policy (Pin 1). */
export type DrainBudget = {
  readonly maxAttempts: number;
  /** After the budget is spent for a SAME-instance flap:
   *   - `"adopt-stale"` — ride the resident daemon (canvas works; anomaly surfaces)
   *   - `"refuse"` — leave standing + degraded, never adopt a contested build
   *  Cross-supervisor fight-detection (a drained lineage reappearing under a foreign
   *  instance) always yields the `cross-supervisor` anomaly, independent of this. */
  readonly onGiveUp: "refuse" | "adopt-stale";
};

/** A daemon's full convergence policy — capability + baked identity + one policy per
 *  trigger + (when drainable) the budget. The `capability` field is tied to the probe's
 *  at the enactment call site, so the drain arms/budget are spellable iff the handshake
 *  can actually drain (Pin 1). `baked` folds into the policy so the policy object alone
 *  is the consumer's whole convergence surface. */
export type ConvergencePolicy<Cap extends DrainCapability> = {
  readonly capability: Cap;
  /** The supervisor's OWN baked identity — the daemon it would spawn. */
  readonly baked: ConvergenceIdentity;
  readonly onContractSkew: ContractSkewPolicy<Cap>;
  readonly onBuildMismatch: BuildMismatchPolicy<Cap>;
} & (Cap extends "drainable"
  ? { readonly drainBudget: DrainBudget }
  : { readonly drainBudget?: never });

/** The widened, all-arms view the PURE `decide()` consumes. Every `ConvergencePolicy<Cap>`
 *  is assignable to this (its arms are a subset of the drainable arms), so `decide` stays
 *  exhaustive over a concrete union while Pin 1 is enforced at the enactment boundary. */
export interface AnyConvergencePolicy {
  readonly onContractSkew: ContractSkewPolicy<"drainable">;
  readonly onBuildMismatch: BuildMismatchPolicy<"drainable">;
}
