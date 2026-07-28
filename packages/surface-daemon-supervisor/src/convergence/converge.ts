/**
 * `converge(endpoint)` — the endpoint-arm enactment of the kit. The ONLY boot verb on
 * an endpoint: probe → decide → budget-gated drain → private bind methods.
 *
 * Outcome kinds either **always** carry their anomaly or **never** do — no optionals.
 * Standing anomalies put evidence in typed fields (`detail` is garnish only).
 */

import {
  buildLabel,
  type ConvergenceIdentity,
  type Logger,
} from "@kolu/surface-daemon";
import type { ConvergenceAnomaly } from "./anomaly.ts";
import type {
  DrainAdmission,
  DrainBudgetMemory,
  DrainLineage,
} from "./budget.ts";
import {
  drainAndAwaitExit,
  drainRejectionSuffix,
} from "./drainAndAwaitExit.ts";
import { decide } from "./decide.ts";
import { giveUpOutcome } from "./giveUp.ts";
import { type InstanceKey, instanceKeyFromStartedAt } from "./instanceKey.ts";
import type { ConvergencePolicy, DrainCapability } from "./policy.ts";

/**
 * The face `converge` enacts through — the public Endpoint fields it needs.
 * Private bind methods are NOT on this type (or on Endpoint); runtime objects
 * from createEndpoint still carry them, and {@link converge} reaches them via
 * a structural cast after checking they exist.
 */
export interface ConvergingEndpoint<
  Cap extends DrainCapability = DrainCapability,
> {
  readonly policy: ConvergencePolicy<Cap>;
  probe: () => Promise<ConvergenceProbe<Cap> | null>;
  readonly budget: Cap extends "drainable"
    ? DrainBudgetMemory
    : DrainBudgetMemory | null;
  readonly log: Logger;
}

/** Runtime bind methods — present on createEndpoint objects, absent from the type. */
type EndpointBinds = {
  adoptOrSpawnOrRefuse: () => Promise<boolean>;
  adoptOrEnsure: () => Promise<boolean>;
};

export interface ConvergenceProbeBase {
  readonly identity: ConvergenceIdentity;
  /**
   * Instance key for the drain budget. Prefer {@link instanceKeyFromStartedAt}.
   * `pre-instance` when the handshake has no startedAt (absent means older).
   */
  readonly instanceKey: InstanceKey;
  dispose(): void;
}

export interface DrainableProbe extends ConvergenceProbeBase {
  readonly capability: "drainable";
  fireDrain(): Promise<void>;
  awaitExit(signal: AbortSignal): Promise<void>;
  readonly drainCeilingMs: number;
}

export interface PlainProbe extends ConvergenceProbeBase {
  readonly capability: "not-drainable";
}

export type ConvergenceProbe<Cap extends DrainCapability> =
  Cap extends "drainable" ? DrainableProbe : PlainProbe;

type AnyConvergenceProbe = DrainableProbe | PlainProbe;

/**
 * Outcome of `converge`. Anomaly is required on kinds that can be degraded and
 * **absent** on kinds that cannot — never optional.
 */
export type ConvergenceOutcome =
  /** Clean adopt — no anomaly field (cannot disagree). */
  | { readonly kind: "adopted" }
  /** Adopted a stale build — anomaly always present. */
  | {
      readonly kind: "adopted-stale";
      readonly anomaly: Extract<ConvergenceAnomaly, { kind: "adopted-stale" }>;
    }
  | { readonly kind: "not-adopted" }
  | {
      readonly kind: "not-adopted-stale";
      readonly anomaly: Extract<ConvergenceAnomaly, { kind: "adopted-stale" }>;
    }
  | { readonly kind: "recycled"; readonly adopted: boolean }
  | {
      readonly kind: "refused";
      readonly adopted: false;
      readonly anomaly: ConvergenceAnomaly;
    }
  | {
      readonly kind: "drained-replacing";
      readonly axis: "contract" | "build";
      readonly running: ConvergenceIdentity;
      readonly adopted: boolean;
    }
  | {
      readonly kind: "mismatch-reported";
      readonly running: ConvergenceIdentity;
      readonly adopted: boolean;
    };

/** Whether a survivor was ADOPTED (its children preserved). */
export function outcomeAdopted(outcome: ConvergenceOutcome): boolean {
  switch (outcome.kind) {
    case "adopted":
    case "adopted-stale":
      return true;
    case "not-adopted":
    case "not-adopted-stale":
      return false;
    case "recycled":
    case "drained-replacing":
    case "mismatch-reported":
      return outcome.adopted;
    case "refused":
      return false;
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`unreachable outcome: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Standing anomaly on an outcome, if this kind carries one. */
export function outcomeAnomaly(
  outcome: ConvergenceOutcome,
): ConvergenceAnomaly | null {
  switch (outcome.kind) {
    case "adopted-stale":
    case "not-adopted-stale":
    case "refused":
      return outcome.anomaly;
    case "adopted":
    case "not-adopted":
    case "recycled":
    case "drained-replacing":
    case "mismatch-reported":
      return null;
    default: {
      const _exhaustive: never = outcome;
      throw new Error(`unreachable outcome: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function lineageOf(probe: AnyConvergenceProbe): DrainLineage {
  return {
    build: probe.identity.build,
    instanceKey: probe.instanceKey,
  };
}

/**
 * Accept a spy {@link ConvergingEndpoint} (tests) or a public {@link Endpoint}
 * from createEndpoint (runtime object still carries private binds).
 */
export async function converge<Cap extends DrainCapability>(
  endpoint: ConvergingEndpoint<Cap>,
): Promise<ConvergenceOutcome> {
  // Runtime createEndpoint objects include the private binds even though the
  // public Endpoint / ConvergingEndpoint types omit them.
  const binds = endpoint as ConvergingEndpoint<Cap> & Partial<EndpointBinds>;
  if (
    typeof binds.adoptOrEnsure !== "function" ||
    typeof binds.adoptOrSpawnOrRefuse !== "function"
  ) {
    throw new Error(
      "converge: endpoint is missing private bind methods — use createEndpoint",
    );
  }
  const face = binds as ConvergingEndpoint<Cap> & EndpointBinds;
  const policy = face.policy;
  const baked = policy.baked;
  const probe: AnyConvergenceProbe | null = await face.probe();

  const bind =
    policy.onContractSkew.kind === "recycle"
      ? face.adoptOrEnsure
      : face.adoptOrSpawnOrRefuse;

  if (probe === null) {
    const adopted = await bind();
    return adopted ? { kind: "adopted" } : { kind: "not-adopted" };
  }

  try {
    const decision = decide(baked, probe.identity, policy);
    const skewCtx = {
      runningContract: probe.identity.contractVersion,
      mineContract: baked.contractVersion,
      runningBuild: buildLabel(probe.identity.build),
      mineBuild: buildLabel(baked.build),
    };
    switch (decision.kind) {
      case "spawn":
      case "adopt": {
        const adopted = await bind();
        return adopted ? { kind: "adopted" } : { kind: "not-adopted" };
      }
      case "recycle": {
        face.log.warn(
          skewCtx,
          "convergence: recycling a contract-skewed survivor (kill + respawn)",
        );
        const adopted = await bind();
        return { kind: "recycled", adopted };
      }
      case "refuse": {
        const detail =
          `convergence: REFUSING a skewed survivor — left standing + degraded, never touched ` +
          `(running contract ${probe.identity.contractVersion}, mine ${baked.contractVersion})`;
        face.log.warn(skewCtx, detail);
        const adopted = await bind();
        if (adopted) {
          return { kind: "adopted" };
        }
        return {
          kind: "refused",
          adopted: false,
          anomaly: {
            kind: "skew-refused",
            running: probe.identity,
            expected: baked,
            detail,
          },
        };
      }
      case "drain-and-replace": {
        if (probe.capability !== "drainable") {
          throw new Error(
            "convergence: drain-and-replace decided for a non-drainable probe — unreachable by Pin 1",
          );
        }
        if (policy.capability !== "drainable" || face.budget === null) {
          throw new Error(
            "convergence: drain-and-replace decided without a drain budget — unreachable by Pin 1",
          );
        }
        const budget = face.budget;
        const why =
          decision.axis === "contract"
            ? `contract skew (mine ${baked.contractVersion} newer than running ${probe.identity.contractVersion})`
            : `build mismatch (running=${buildLabel(probe.identity.build)} expected=${buildLabel(baked.build)})`;
        const admission = budget.admit(lineageOf(probe), why);
        if (admission.kind === "giveUp") {
          return enactGiveUp({
            admission,
            onGiveUp: budget.drainBudget.onGiveUp,
            axis: decision.axis,
            running: probe.identity,
            expected: baked,
            bind,
            log: face.log,
            skewCtx,
          });
        }
        face.log.info(
          { axis: decision.axis, attempt: admission.attempt, ...skewCtx },
          "convergence: draining a superseded survivor (persist + exit; its children survive) and respawning our own build",
        );
        const drain = await drainAndAwaitExit(
          () => probe.fireDrain(),
          (signal) => probe.awaitExit(signal),
          { ceilingMs: probe.drainCeilingMs },
        );
        if (!drain.took) {
          const notTaken =
            `${why}: drain did not take within ${probe.drainCeilingMs}ms — the daemon kept answering` +
            drainRejectionSuffix(drain.drainRejection);
          face.log.error(
            { axis: decision.axis, ...skewCtx },
            `convergence: drain FAILED — ${notTaken}`,
          );
          return enactGiveUp({
            admission: {
              kind: "giveUp",
              why: "budget",
              reason: notTaken,
            },
            onGiveUp: budget.drainBudget.onGiveUp,
            axis: decision.axis,
            running: probe.identity,
            expected: baked,
            bind,
            log: face.log,
            skewCtx,
          });
        }
        const adopted = await bind();
        return {
          kind: "drained-replacing",
          axis: decision.axis,
          running: probe.identity,
          adopted,
        };
      }
      case "report-mismatch": {
        const adopted = await bind();
        return {
          kind: "mismatch-reported",
          running: decision.running,
          adopted,
        };
      }
      default: {
        const _exhaustive: never = decision;
        throw new Error(
          `unreachable convergence decision: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  } finally {
    probe.dispose();
  }
}

async function enactGiveUp(args: {
  admission: Extract<DrainAdmission, { kind: "giveUp" }>;
  onGiveUp: "refuse" | "adopt-stale";
  axis: "contract" | "build";
  running: ConvergenceIdentity;
  expected: ConvergenceIdentity;
  bind: () => Promise<boolean>;
  log: Logger;
  skewCtx: Record<string, string>;
}): Promise<ConvergenceOutcome> {
  const g = giveUpOutcome({
    admission: args.admission,
    onGiveUp: args.onGiveUp,
    axis: args.axis,
    running: args.running,
    expected: args.expected,
    log: args.log,
    skewCtx: args.skewCtx,
    logPrefix: "convergence",
  });
  if (g.kind === "adopt-stale") {
    const adopted = await args.bind();
    return adopted
      ? { kind: "adopted-stale", anomaly: g.anomaly }
      : { kind: "not-adopted-stale", anomaly: g.anomaly };
  }
  return { kind: "refused", adopted: false, anomaly: g.anomaly };
}

// Re-export for probe authors that still think in startedAt.
export { instanceKeyFromStartedAt };
