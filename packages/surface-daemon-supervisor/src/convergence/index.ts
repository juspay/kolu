/**
 * The daemon-convergence kit — "the running daemon is not the one I shipped: detect it,
 * decide, converge it." One shared mechanism (probe → pure {@link decide} → enact via
 * the endpoint or a connector), with POLICY AS THE PARAMETER: each daemon declares its
 * {@link ConvergencePolicy} once (who I am + how I converge, including `baked` and the
 * Cap-gated `drainBudget`) and the machinery is shared. kaval declares recycle-on-skew +
 * nudge-human (no budget); padi declares drain-newer-else-refuse + drain-and-replace
 * with a budget that survives adopts.
 *
 * Three make-illegal-unrepresentable pins:
 *   - Pin 1 (drain capability typed) — the drain policy arms and `drainBudget` exist
 *     only for a drainable handshake; a drainless daemon (kaval) declaring one is a
 *     compile error (and never constructs an inert fence).
 *   - Pin 2 (ordering per-field law) — contract versions are ORDERED; build ids are
 *     MATCH-ONLY, with no ordering exported to spell.
 *   - Pin 3 (identity reachable under skew) — the probe reads identity over a
 *     version-agnostic channel, before any versioned handshake.
 */

// The convergence comparators + identity shape live in @kolu/surface-daemon (the
// supervisor's zero-@kolu/surface boundary; see convergenceIdentity.ts) — re-exported
// here so a consumer gets the whole kit from @kolu/surface-daemon-supervisor.
export {
  buildLabel,
  buildsMatch,
  contractIsCompatible,
  contractIsNewer,
  type ConvergenceIdentity,
  type DaemonBuild,
  daemonBuild,
} from "@kolu/surface-daemon";
export type { ConvergenceAnomaly } from "./anomaly.ts";
export {
  type DrainAdmission,
  type DrainBudgetMemory,
  type DrainLineage,
  createDrainBudget,
} from "./budget.ts";
export {
  type ConvergeAdmitVerdict,
  type RunningDaemon,
  convergeAdmit,
} from "./convergeAdmit.ts";
export {
  type ConvergenceOutcome,
  type ConvergenceProbe,
  type ConvergenceProbeBase,
  type ConvergingEndpoint,
  type DrainableProbe,
  type PlainProbe,
  converge,
  outcomeAdopted,
  outcomeAnomaly,
} from "./converge.ts";
export { type Decision, decide } from "./decide.ts";
export {
  type DrainAndAwaitExitResult,
  drainAndAwaitExit,
  drainRejectionSuffix,
} from "./drainAndAwaitExit.ts";
export type {
  AnyConvergencePolicy,
  BuildMismatchPolicy,
  ContractSkewPolicy,
  ConvergencePolicy,
  DrainBudget,
  DrainCapability,
} from "./policy.ts";
