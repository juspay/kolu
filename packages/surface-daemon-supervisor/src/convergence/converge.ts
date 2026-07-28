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

function identityUnverifiable(args: {
  running: ConvergenceIdentity;
  expected: ConvergenceIdentity;
  log: Logger;
}): ConvergenceOutcome {
  const cause = { kind: "identity-unverifiable" as const };
  const detail =
    `bound a resident whose identity the probe could not re-characterize ` +
    `(last known running=${buildLabel(args.running.build)}; expected=${buildLabel(args.expected.build)})`;
  args.log.error({}, `convergence: UNCONVERGED — ${detail}`);
  return {
    kind: "refused",
    adopted: false,
    anomaly: {
      kind: "unconverged",
      running: args.running,
      expected: args.expected,
      cause,
      detail,
    },
  };
}

function probeFailed(args: {
  message: string;
  expected: ConvergenceIdentity;
  log: Logger;
}): ConvergenceOutcome {
  const cause = { kind: "probe-failed" as const, message: args.message };
  const detail = `convergence probe failed: ${args.message}`;
  args.log.error({}, `convergence: UNCONVERGED — ${detail}`);
  return {
    kind: "refused",
    adopted: false,
    anomaly: {
      kind: "unconverged",
      running: args.expected,
      expected: args.expected,
      cause,
      detail,
    },
  };
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

  let probeResult: AnyConvergenceProbe | null;
  try {
    probeResult = await endpoint.probe();
  } catch (err) {
    // F2: non-listener probe failures are typed unconverged, not unhandled rejection.
    const message = err instanceof Error ? err.message : String(err);
    return probeFailed({ message, expected: baked, log: endpoint.log });
  }

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
            bind,
            endpointProbe: () => endpoint.probe(),
          });
        } finally {
          again.dispose();
        }
      }
      // F1b: adopted a resident the probe cannot characterize — never clean.
      return identityUnverifiable({
        running: baked,
        expected: baked,
        log: endpoint.log,
      });
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
        // Cap generics don't narrow on the runtime checks above — rebind for Pin 1.
        const drainableProbe: DrainableProbe = probe;
        const drainablePolicy = policy as ConvergencePolicy<"drainable">;
        return enactDrainLoop({
          initialProbe: drainableProbe,
          axis: decision.axis,
          policy: drainablePolicy,
          budget: endpoint.budget,
          bind,
          log: endpoint.log,
          skewCtx,
          endpointProbe: () => endpoint.probe(),
        });
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
 * F1(a): budget-gated drain → bind → re-probe loop. When the successor is still
 * wrong and the budget admits another drain, enact it (never adopted-stale while
 * budget remains). adopted-stale only on give-up at the top of a loop iteration.
 */
async function enactDrainLoop(args: {
  initialProbe: DrainableProbe;
  axis: "contract" | "build";
  policy: ConvergencePolicy<"drainable">;
  budget: DrainBudgetHandle;
  bind: () => Promise<BindResult>;
  log: Logger;
  skewCtx: Record<string, string>;
  endpointProbe: () => Promise<AnyConvergenceProbe | null>;
}): Promise<ConvergenceOutcome> {
  const baked = args.policy.baked;
  let current: DrainableProbe = args.initialProbe;
  let axis = args.axis;
  /** Probes we promoted into `current` after the initial (caller-owned) probe. */
  let owned: DrainableProbe | null = null;

  try {
    for (;;) {
      const why =
        axis === "contract"
          ? `contract skew (mine ${baked.contractVersion} newer than running ${current.identity.contractVersion})`
          : `build mismatch (running=${buildLabel(current.identity.build)} expected=${buildLabel(baked.build)})`;
      const admission = budgetInternal(args.budget).admit(
        lineageOf(current.identity, current.instanceKey),
        why,
      );
      if (admission.kind === "giveUp") {
        return enactGiveUp({
          admission,
          onGiveUp: drainBudgetOf(args.budget).onGiveUp,
          axis,
          running: current.identity,
          expected: baked,
          bind: args.bind,
          log: args.log,
          skewCtx: args.skewCtx,
        });
      }
      args.log.info(
        { axis, attempt: admission.attempt, ...args.skewCtx },
        "convergence: draining a superseded survivor (persist + exit; its children survive) and respawning our own build",
      );
      const drain = await drainAndAwaitExit(
        () => current.fireDrain(),
        (signal) => current.awaitExit(signal),
        { ceilingMs: current.drainCeilingMs },
      );
      if (!drain.took) {
        args.log.error(
          { axis, ...args.skewCtx },
          `convergence: drain FAILED — not taken within ${current.drainCeilingMs}ms` +
            drainRejectionSuffix(drain.drainRejection),
        );
        return enactGiveUp({
          admission: {
            kind: "giveUp",
            why: "budget",
            axisHint: why,
            attempts: admission.attempt,
            maxAttempts: drainBudgetOf(args.budget).maxAttempts,
            instanceKey: current.instanceKey,
          },
          onGiveUp: drainBudgetOf(args.budget).onGiveUp,
          axis,
          running: current.identity,
          expected: baked,
          bind: args.bind,
          log: args.log,
          skewCtx: args.skewCtx,
          drainNotTaken: {
            ceilingMs: current.drainCeilingMs,
            rejection: drain.drainRejection,
          },
        });
      }

      const r = await args.bind();
      if (r.kind === "spawned-fresh") {
        return {
          kind: "drained-replacing",
          axis,
          running: current.identity,
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
            maxAttempts: drainBudgetOf(args.budget).maxAttempts,
            instanceKey: current.instanceKey,
          },
          onGiveUp: "refuse",
          axis,
          running: current.identity,
          expected: baked,
          bind: async () => ({ kind: "refused-or-failed" }),
          log: args.log,
          skewCtx: args.skewCtx,
          forceUnconverged: true,
        });
      }

      // adopted-resident after drain — re-probe successor (F1).
      const successor = await args.endpointProbe();
      if (successor === null) {
        return identityUnverifiable({
          running: current.identity,
          expected: baked,
          log: args.log,
        });
      }

      if (
        contractIsCompatible(
          baked.contractVersion,
          successor.identity.contractVersion,
        ) &&
        buildsMatch(baked.build, successor.identity.build)
      ) {
        successor.dispose();
        return {
          kind: "drained-replacing",
          axis,
          running: current.identity,
          bind: r,
        };
      }

      // Still wrong — promote successor and loop. Next iteration admits (F1a
      // same-lineage continues while budget remains; foreign instance →
      // cross-supervisor give-up; exhausted → adopted-stale / refuse).
      if (successor.capability !== "drainable") {
        successor.dispose();
        throw new Error(
          "convergence: post-drain successor needs drain but is not drainable — unreachable by Pin 1",
        );
      }
      owned?.dispose();
      owned = successor;
      current = successor;
      axis = !contractIsCompatible(
        baked.contractVersion,
        successor.identity.contractVersion,
      )
        ? "contract"
        : "build";
    }
  } finally {
    owned?.dispose();
  }
}

/**
 * F1: after bind retained a resident (null-probe race / non-drain paths), verify
 * via decide + budget fold. Same-lineage admitted drain continues via
 * {@link enactDrainLoop}.
 */
async function evaluateBoundResident(args: {
  probe: AnyConvergenceProbe;
  policy: ConvergencePolicy<DrainCapability>;
  budget: DrainBudgetHandle | null;
  bindResult: BindResult;
  log: Logger;
  axis: "contract" | "build" | null;
  bind: () => Promise<BindResult>;
  endpointProbe?: () => Promise<AnyConvergenceProbe | null>;
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
      ? `post-bind resident contract skew`
      : `post-bind resident build mismatch (running=${buildLabel(running.build)} expected=${buildLabel(baked.build)})`;
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

  // F1a: admission says drain — enact it (do not return adopted-stale while budget remains).
  if (args.probe.capability !== "drainable") {
    throw new Error(
      "convergence: admit said drain for a non-drainable bound resident — unreachable by Pin 1",
    );
  }
  // Capability check above; Cap-union doesn't narrow — rebind as DrainableProbe.
  const drainable: DrainableProbe = args.probe;
  // Already admitted once — drain with that grant, then re-evaluate the successor
  // (do not re-enter enactDrainLoop, which would double-count the admit).
  const axis = args.axis ?? "build";
  args.log.info(
    { axis, attempt: admission.attempt },
    "convergence: draining a bound mismatched resident (budget admits another attempt)",
  );
  const drain = await drainAndAwaitExit(
    () => drainable.fireDrain(),
    (signal) => drainable.awaitExit(signal),
    { ceilingMs: drainable.drainCeilingMs },
  );
  if (!drain.took) {
    return enactGiveUp({
      admission: {
        kind: "giveUp",
        why: "budget",
        axisHint: why,
        attempts: admission.attempt,
        maxAttempts: drainBudgetOf(args.budget).maxAttempts,
        instanceKey: drainable.instanceKey,
      },
      onGiveUp: drainBudgetOf(args.budget).onGiveUp,
      axis,
      running,
      expected: baked,
      bind: args.bind,
      log: args.log,
      skewCtx: {},
      drainNotTaken: {
        ceilingMs: drainable.drainCeilingMs,
        rejection: drain.drainRejection,
      },
    });
  }
  const r = await args.bind();
  if (r.kind === "spawned-fresh") {
    return {
      kind: "drained-replacing",
      axis,
      running,
      bind: r,
    };
  }
  if (r.kind === "refused-or-failed") {
    return {
      kind: "refused",
      adopted: false,
      anomaly: {
        kind: "unconverged",
        running,
        expected: baked,
        cause: { kind: "adopt-bind-failed", axis },
        detail: "bind refused or failed after admitted drain of bound resident",
      },
    };
  }
  const probeFn = args.endpointProbe;
  if (probeFn === undefined) {
    // Without a re-probe seam, treat as identity-unverifiable (should not happen
    // from production call sites — they always pass endpoint.probe).
    return identityUnverifiable({
      running,
      expected: baked,
      log: args.log,
    });
  }
  const successor = await probeFn();
  if (successor === null) {
    return identityUnverifiable({
      running,
      expected: baked,
      log: args.log,
    });
  }
  try {
    return await evaluateBoundResident({
      probe: successor,
      policy: args.policy,
      budget: args.budget,
      bindResult: r,
      log: args.log,
      axis,
      bind: args.bind,
      endpointProbe: probeFn,
    });
  } finally {
    successor.dispose();
  }
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
