/**
 * The daemon-convergence kit — "the running daemon is not the one I shipped: detect it,
 * decide, converge it." One shared mechanism (probe → pure {@link decide} → enact via
 * the endpoint or a connector), with POLICY AS THE PARAMETER.
 */

export {
  buildLabel,
  buildsMatch,
  contractIsCompatible,
  contractIsNewer,
  type ConvergenceIdentity,
  type DaemonBuild,
  daemonBuild,
} from "@kolu/surface-daemon";
export type {
  ConvergenceAnomaly,
  RefusedAnomaly,
  UnconvergedCause,
} from "./anomaly.ts";
export type { BindResult } from "./bindResult.ts";
export {
  type ConnectorDrainBudget,
  type DrainAdmission,
  type DrainBudgetHandle,
  type DrainBudgetMemory,
  type DrainGiveUp,
  type DrainLineage,
  budgetInternal,
  createConnectorDrainBudget,
  createDrainBudget,
  drainBudgetOf,
  policyOf,
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
  type DrainableProbe,
  type PlainProbe,
  converge,
  instanceKeyFromStartedAt,
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
  ConnectorPolicy,
  ContractSkewPolicy,
  ConvergencePolicy,
  DrainBudget,
  DrainCapability,
} from "./policy.ts";
export {
  type InstanceKey,
  type NamedInstanceKey,
  type PreInstanceKey,
  instanceKeyTag,
} from "./instanceKey.ts";
