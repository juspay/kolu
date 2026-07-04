/**
 * Convergence POLICY — the parameter each daemon declares, one policy per trigger
 * (contract-skew, build-mismatch). The machinery (probe → decide → enact) is shared;
 * only these declarations vary per daemon.
 *
 * Pin 1 (drain capability is typed, make-illegal-unrepresentable): a `drain-and-replace`
 * / `drain-newer-else-refuse` arm PERSISTS the daemon (graceful drain, its children
 * survive) rather than killing it — which requires the daemon to actually expose a drain
 * verb on its handshake. So the drain arms exist in the policy union ONLY when the
 * `DrainCapability` is `"drainable"`, and `converge()` ties that capability to the
 * PROBE's (a probe with a `drain()` is `"drainable"`, one without is `"not-drainable"`).
 * A daemon whose handshake has no drain verb (kaval — recycling it kills PTYs, so it
 * never drains) therefore CANNOT spell a drain policy: the arm is `never` and the
 * declaration is a compile error, not a runtime surprise.
 */

/** Whether a daemon's handshake exposes a `drain` verb — the type-level gate on the
 *  drain policy arms. */
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
 *   - `drain-and-replace` — DRAIN the survivor ONCE per supervisor boot (fenced) and
 *     spawn our own build (padi: drain is cheap, its kaval + PTYs survive). Drain-capable
 *     only. Store hashes don't order, so this is match-vs-mismatch, never newer/older. */
export type BuildMismatchPolicy<Cap extends DrainCapability> =
  | { readonly kind: "nudge-human" }
  | (Cap extends "drainable" ? { readonly kind: "drain-and-replace" } : never);

/** A daemon's full convergence policy — its capability + one policy per trigger. The
 *  `capability` field is tied to the probe's at the `converge()` call site, so the drain
 *  arms are spellable iff the handshake can actually drain (Pin 1). */
export interface ConvergencePolicy<Cap extends DrainCapability> {
  readonly capability: Cap;
  readonly onContractSkew: ContractSkewPolicy<Cap>;
  readonly onBuildMismatch: BuildMismatchPolicy<Cap>;
}

/** The widened, all-arms view the PURE `decide()` consumes. Every `ConvergencePolicy<Cap>`
 *  is assignable to this (its arms are a subset of the drainable arms), so `decide` stays
 *  exhaustive over a concrete union while Pin 1 — the drain arms gated on capability — is
 *  enforced at the `converge()` boundary, where the probe fixes `Cap`. `decide` never sees
 *  a drain arm for a non-drainable daemon because `converge` can't be handed one. */
export interface AnyConvergencePolicy {
  readonly onContractSkew: ContractSkewPolicy<"drainable">;
  readonly onBuildMismatch: BuildMismatchPolicy<"drainable">;
}
