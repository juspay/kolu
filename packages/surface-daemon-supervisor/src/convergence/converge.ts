/**
 * `converge(endpoint)` — the endpoint-arm enactment of the kit. The ONLY boot verb on
 * an endpoint: probe → decide → budget-gated drain → private bind methods.
 *
 * Accepts only a genuine {@link createEndpoint} handle (F12 WeakMap brand).
 * Outcome kinds either **always** carry their anomaly or **never** do.
 */

import {
  buildLabel,
  buildsMatch,
  type ConvergenceIdentity,
  contractIsCompatible,
  type Logger,
} from "@kolu/surface-daemon";
import type { ConvergenceAnomaly, RefusedAnomaly } from "./anomaly.ts";
import type { BindResult } from "./bindResult.ts";
import {
  type DrainAdmission,
  type DrainBudgetHandle,
  type DrainLineage,
  budgetInternal,
  drainBudgetOf,
} from "./budget.ts";
import {
  drainAndAwaitExit,
  drainRejectionSuffix,
} from "./drainAndAwaitExit.ts";
import { decide } from "./decide.ts";
import { giveUpOutcome } from "./giveUp.ts";
import { type InstanceKey, instanceKeyFromStartedAt } from "./instanceKey.ts";
import type { ConvergencePolicy, DrainCapability } from "./policy.ts";
import { endpointPrivate } from "../endpoint.private.ts";
import type { Endpoint } from "../endpoint.ts";

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
  /**
   * Observe that the daemon process actually left. MUST resolve only from an
   * independent process/instance oracle (gate/pid gone, socket close of the
   * daemon process). Sustained RPC failure alone is NOT exit (F3).
   */
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
 * **absent** on kinds that cannot — never optional. `not-adopted-stale` deleted
 * (F5): adopted-stale only when a resident was adopted.
 */
export type ConvergenceOutcome =
  | { readonly kind: "adopted" }
  | {
      readonly kind: "adopted-stale";
      readonly anomaly: Extract<ConvergenceAnomaly, { kind: "adopted-stale" }>;
    }
  | { readonly kind: "not-adopted" }
  | { readonly kind: "spawned-fresh" }
  | { readonly kind: "recycled"; readonly bind: BindResult }
  | {
      readonly kind: "refused";
      readonly adopted: false;
      readonly anomaly: RefusedAnomaly;
    }
  | {
      readonly kind: "drained-replacing";
      readonly axis: "contract" | "build";
      readonly running: ConvergenceIdentity;
      readonly bind: BindResult;
    }
  | {
      readonly kind: "mismatch-reported";
      readonly running: ConvergenceIdentity;
      readonly bind: BindResult;
    };

/** Whether a survivor was ADOPTED (its children preserved). */
export function outcomeAdopted(outcome: ConvergenceOutcome): boolean {
  switch (outcome.kind) {
    case "adopted":
    case "adopted-stale":
      return true;
    case "not-adopted":
    case "spawned-fresh":
    case "refused":
      return false;
    case "recycled":
    case "drained-replacing":
    case "mismatch-reported":
      return outcome.bind.kind === "adopted-resident";
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
    case "refused":
      return outcome.anomaly;
    case "adopted":
    case "not-adopted":
    case "spawned-fresh":
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

function lineageOf(
  identity: ConvergenceIdentity,
  instanceKey: InstanceKey,
): DrainLineage {
  return { build: identity.build, instanceKey };
}

function bindOutcomeFromResult(r: BindResult): ConvergenceOutcome {
  switch (r.kind) {
    case "adopted-resident":
      return { kind: "adopted" };
    case "spawned-fresh":
      return { kind: "spawned-fresh" };
    case "refused-or-failed":
      return { kind: "not-adopted" };
    default: {
      const _e: never = r;
      throw new Error(`unreachable BindResult: ${JSON.stringify(_e)}`);
    }
  }
}

/**
 * `converge` — only a genuine createEndpoint handle (F12).
 */
export async function converge<
  C,
  I,
  M = undefined,
  Cap extends DrainCapability = DrainCapability,
>(endpoint: Endpoint<C, I, M, Cap>): Promise<ConvergenceOutcome> {
  const binds = endpointPrivate(endpoint);
  const policy = endpoint.policy;
  const baked = policy.baked;
  const probeResult = await endpoint.probe();

  const bind =
    policy.onContractSkew.kind === "recycle"
      ? () => binds.adoptOrEnsure()
      : () => binds.adoptOrSpawnOrRefuse();

  if (probeResult === null) {
    // F2: null means honest no-listener. If bind adopts a resident anyway, that is
    // a race — re-probe and never silently ride a mismatch.
    const r = await bind();
    if (r.kind === "adopted-resident") {
      const again = await endpoint.probe();
      if (again !== null) {
        try {
          return await evaluateBoundResident({
            probe: again,
            policy,
            budget: endpoint.budget,
            bindResult: r,
            log: endpoint.log,
            axis: null,
          });
        } finally {
          again.dispose();
        }
      }
    }
    return bindOutcomeFromResult(r);
  }

  const probe: AnyConvergenceProbe = probeResult;
  try {
    const decision = decide(policy, probe.identity);
    const skewCtx = {
      runningContract: probe.identity.contractVersion,
      mineContract: baked.contractVersion,
      runningBuild: buildLabel(probe.identity.build),
      mineBuild: buildLabel(baked.build),
    };
    switch (decision.kind) {
      case "spawn":
      case "adopt": {
        return bindOutcomeFromResult(await bind());
      }
      case "recycle": {
        endpoint.log.warn(
          skewCtx,
          "convergence: recycling a contract-skewed survivor (kill + respawn)",
        );
        return { kind: "recycled", bind: await bind() };
      }
      case "refuse": {
        const detail =
          `convergence: REFUSING a skewed survivor — left standing + degraded, never touched ` +
          `(running contract ${probe.identity.contractVersion}, mine ${baked.contractVersion})`;
        endpoint.log.warn(skewCtx, detail);
        const r = await bind();
        if (r.kind === "adopted-resident") {
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
        if (policy.capability !== "drainable" || endpoint.budget === null) {
          throw new Error(
            "convergence: drain-and-replace decided without a drain budget — unreachable by Pin 1",
          );
        }
        const budget = endpoint.budget;
        const why =
          decision.axis === "contract"
            ? `contract skew (mine ${baked.contractVersion} newer than running ${probe.identity.contractVersion})`
            : `build mismatch (running=${buildLabel(probe.identity.build)} expected=${buildLabel(baked.build)})`;
        const admission = budgetInternal(budget).admit(
          lineageOf(probe.identity, probe.instanceKey),
          why,
        );
        if (admission.kind === "giveUp") {
          return enactGiveUp({
            admission,
            onGiveUp: drainBudgetOf(budget).onGiveUp,
            axis: decision.axis,
            running: probe.identity,
            expected: baked,
            bind,
            log: endpoint.log,
            skewCtx,
          });
        }
        endpoint.log.info(
          { axis: decision.axis, attempt: admission.attempt, ...skewCtx },
          "convergence: draining a superseded survivor (persist + exit; its children survive) and respawning our own build",
        );
        const drain = await drainAndAwaitExit(
          () => probe.fireDrain(),
          (signal) => probe.awaitExit(signal),
          { ceilingMs: probe.drainCeilingMs },
        );
        if (!drain.took) {
          endpoint.log.error(
            { axis: decision.axis, ...skewCtx },
            `convergence: drain FAILED — not taken within ${probe.drainCeilingMs}ms` +
              drainRejectionSuffix(drain.drainRejection),
          );
          return enactGiveUp({
            admission: {
              kind: "giveUp",
              why: "budget",
              axisHint: why,
              attempts: admission.attempt,
              maxAttempts: drainBudgetOf(budget).maxAttempts,
              instanceKey: probe.instanceKey,
            },
            onGiveUp: drainBudgetOf(budget).onGiveUp,
            axis: decision.axis,
            running: probe.identity,
            expected: baked,
            bind,
            log: endpoint.log,
            skewCtx,
            drainNotTaken: {
              ceilingMs: probe.drainCeilingMs,
              rejection: drain.drainRejection,
            },
          });
        }
        // F1: bind then verify successor through budget fold — never silent ride.
        const r = await bind();
        if (r.kind === "spawned-fresh") {
          return {
            kind: "drained-replacing",
            axis: decision.axis,
            running: probe.identity,
            bind: r,
          };
        }
        if (r.kind === "refused-or-failed") {
          return enactGiveUp({
            admission: {
              kind: "giveUp",
              why: "budget",
              axisHint: why,
              attempts: admission.attempt,
              maxAttempts: drainBudgetOf(budget).maxAttempts,
              instanceKey: probe.instanceKey,
            },
            onGiveUp: "refuse",
            axis: decision.axis,
            running: probe.identity,
            expected: baked,
            bind: async () => ({ kind: "refused-or-failed" }),
            log: endpoint.log,
            skewCtx,
            forceUnconverged: true,
          });
        }
        // adopted-resident after drain — re-probe successor (F1).
        const successor = await endpoint.probe();
        if (successor === null) {
          return {
            kind: "drained-replacing",
            axis: decision.axis,
            running: probe.identity,
            bind: r,
          };
        }
        try {
          return await evaluateBoundResident({
            probe: successor,
            policy,
            budget,
            bindResult: r,
            log: endpoint.log,
            axis: decision.axis,
            drainedProbe: probe,
          });
        } finally {
          successor.dispose();
        }
      }
      case "report-mismatch": {
        return {
          kind: "mismatch-reported",
          running: decision.running,
          bind: await bind(),
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

/**
 * F1: after bind retained a resident, verify via decide + budget fold.
 * Expected match → clean; foreign instance of drained build → cross-supervisor;
 * same wrong lineage → budget give-up.
 */
async function evaluateBoundResident(args: {
  probe: AnyConvergenceProbe;
  policy: ConvergencePolicy<DrainCapability>;
  budget: DrainBudgetHandle | null;
  bindResult: BindResult;
  log: Logger;
  axis: "contract" | "build" | null;
  drainedProbe?: AnyConvergenceProbe;
}): Promise<ConvergenceOutcome> {
  const baked = args.policy.baked;
  const running = args.probe.identity;
  if (
    contractIsCompatible(baked.contractVersion, running.contractVersion) &&
    buildsMatch(baked.build, running.build)
  ) {
    return { kind: "adopted" };
  }
  if (args.budget === null || args.policy.capability !== "drainable") {
    // Not drainable — report mismatch / refuse via decide
    const d = decide(args.policy, running);
    if (d.kind === "report-mismatch") {
      return {
        kind: "mismatch-reported",
        running,
        bind: args.bindResult,
      };
    }
    return {
      kind: "refused",
      adopted: false,
      anomaly: {
        kind: "skew-refused",
        running,
        expected: baked,
        detail: "bound resident is not the expected identity",
      },
    };
  }
  const why =
    args.axis === "contract"
      ? `post-drain successor contract skew`
      : `post-drain successor build mismatch (running=${buildLabel(running.build)} expected=${buildLabel(baked.build)})`;
  const admission = budgetInternal(args.budget).admit(
    lineageOf(running, args.probe.instanceKey),
    why,
  );
  if (admission.kind === "giveUp" && admission.why === "cross-supervisor") {
    const g = giveUpOutcome({
      admission,
      onGiveUp: drainBudgetOf(args.budget).onGiveUp,
      axis: args.axis ?? "build",
      running,
      expected: baked,
      log: args.log,
      skewCtx: {},
      logPrefix: "convergence",
    });
    return {
      kind: "refused",
      adopted: false,
      anomaly: g.anomaly as RefusedAnomaly,
    };
  }
  if (admission.kind === "giveUp") {
    const g = giveUpOutcome({
      admission,
      onGiveUp: drainBudgetOf(args.budget).onGiveUp,
      axis: args.axis ?? "build",
      running,
      expected: baked,
      log: args.log,
      skewCtx: {},
      logPrefix: "convergence",
    });
    if (g.kind === "adopt-stale") {
      return { kind: "adopted-stale", anomaly: g.anomaly };
    }
    return { kind: "refused", adopted: false, anomaly: g.anomaly };
  }
  // Budget would allow another drain — still wrong identity after adopt: ride stale.
  const detail = `post-drain successor is still not the expected build (running=${buildLabel(running.build)} expected=${buildLabel(baked.build)}) — riding the resident`;
  args.log.warn({}, `convergence: ADOPTED STALE — ${detail}`);
  return {
    kind: "adopted-stale",
    anomaly: {
      kind: "adopted-stale",
      running,
      expected: baked,
      detail,
    },
  };
}

async function enactGiveUp(args: {
  admission: Extract<DrainAdmission, { kind: "giveUp" }>;
  onGiveUp: "refuse" | "adopt-stale";
  axis: "contract" | "build";
  running: ConvergenceIdentity;
  expected: ConvergenceIdentity;
  bind: () => Promise<BindResult>;
  log: Logger;
  skewCtx: Record<string, string>;
  drainNotTaken?: { ceilingMs: number; rejection: string | null };
  forceUnconverged?: boolean;
}): Promise<ConvergenceOutcome> {
  const g = giveUpOutcome({
    admission: args.admission,
    onGiveUp: args.forceUnconverged ? "refuse" : args.onGiveUp,
    axis: args.axis,
    running: args.running,
    expected: args.expected,
    log: args.log,
    skewCtx: args.skewCtx,
    logPrefix: "convergence",
    drainNotTaken: args.drainNotTaken,
  });
  if (g.kind === "adopt-stale") {
    const r = await args.bind();
    if (r.kind === "adopted-resident") {
      return { kind: "adopted-stale", anomaly: g.anomaly };
    }
    if (r.kind === "spawned-fresh") {
      // F5: spawned expected is clean, not stale.
      return { kind: "spawned-fresh" };
    }
    // bind failed after adopt-stale intent → unconverged
    return {
      kind: "refused",
      adopted: false,
      anomaly: {
        kind: "unconverged",
        running: args.running,
        expected: args.expected,
        cause: {
          kind: "adopt-bind-failed",
          axis: args.axis,
        },
        detail: g.anomaly.detail,
      },
    };
  }
  return { kind: "refused", adopted: false, anomaly: g.anomaly };
}

export { instanceKeyFromStartedAt };
