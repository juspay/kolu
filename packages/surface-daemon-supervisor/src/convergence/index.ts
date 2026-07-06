/**
 * The daemon-convergence kit — "the running daemon is not the one I shipped: detect it,
 * decide, converge it." One shared mechanism (probe → pure {@link decide} → enact via the
 * endpoint), with POLICY AS THE PARAMETER: each daemon declares its {@link ConvergencePolicy}
 * per trigger (contract-skew / build-mismatch) and the machinery is shared. kaval declares
 * recycle-on-skew + nudge-human; padi declares drain-newer-else-refuse + drain-and-replace.
 *
 * Three make-illegal-unrepresentable pins:
 *   - Pin 1 (drain capability typed) — the drain policy arms exist only for a drainable
 *     handshake; a drainless daemon (kaval) declaring one is a compile error.
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
export {
  type ConvergenceEndpoint,
  type ConvergenceOutcome,
  type ConvergenceProbe,
  type ConvergenceProbeBase,
  converge,
  type DrainableProbe,
  outcomeAdopted,
  type PlainProbe,
} from "./converge.ts";
export { type Decision, decide } from "./decide.ts";
export { type BuildDrainFence, createBuildDrainFence } from "./fence.ts";
export type {
  AnyConvergencePolicy,
  BuildMismatchPolicy,
  ContractSkewPolicy,
  ConvergencePolicy,
  DrainCapability,
} from "./policy.ts";
