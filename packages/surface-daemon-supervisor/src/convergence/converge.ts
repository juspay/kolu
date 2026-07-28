/**
 * `converge(endpoint)` — the endpoint-arm enactment of the kit. The ONLY boot verb on
 * an endpoint: probe → decide → budget-gated drain → private bind methods.
 *
 * Accepts only a genuine {@link createEndpoint} handle (F12 WeakMap brand).
 * Outcome kinds either **always** carry their anomaly or **never** do.
 */

import {
  buildLabel,
  type ConvergenceIdentity,
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
      // Characterization is required for a clean adopt; callers that reach here
      // without evaluating identity must have already verified match.
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

/** W4.4: every probe site returns probe | null | typed probe-failed outcome. */
type ProbeAttempt =
  | { readonly kind: "probe"; readonly probe: AnyConvergenceProbe }
  | { readonly kind: "absent" }
  | {
      readonly kind: "probe-failed";
      readonly outcome: ConvergenceOutcome;
    };

async function attemptProbe(
  run: () => Promise<AnyConvergenceProbe | null>,
  expected: ConvergenceIdentity,
  log: Logger,
): Promise<ProbeAttempt> {
  try {
    const p = await run();
    if (p === null) return { kind: "absent" };
    return { kind: "probe", probe: p };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind: "probe-failed",
      outcome: probeFailedOutcome({ message, expected, log }),
    };
  }
}

function probeFailedOutcome(args: {
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
  const releaseHeld = (): void => binds.releaseHeld();

  const first = await attemptProbe(() => endpoint.probe(), baked, endpoint.log);
  if (first.kind === "probe-failed") return first.outcome;

  const bind =
    policy.onContractSkew.kind === "recycle"
      ? () => binds.adoptOrEnsure()
      : () => binds.adoptOrSpawnOrRefuse();

  if (first.kind === "absent") {
    // Honest no-listener at primary. Bind may still adopt (adopt-hint / race).
    const r = await bind();
    return await foldBindResult({
      r,
      policy,
      budget: endpoint.budget,
      bind,
      log: endpoint.log,
      axis: null,
      releaseHeld,
      endpointProbe: () => endpoint.probe(),
      expected: baked,
    });
  }

  const probe: AnyConvergenceProbe = first.probe;
  try {
    return await enactDecision({
      decision: decide(policy, probe.identity),
      running: probe.identity,
      instanceKey: probe.instanceKey,
      probe,
      policy,
      budget: endpoint.budget,
      bind,
      log: endpoint.log,
      releaseHeld,
      endpointProbe: () => endpoint.probe(),
      disposeInitialProbe: false,
    });
  } finally {
    probe.dispose();
  }
}

/**
 * Fold a BindResult into an outcome. Adopted residents are evaluated through
 * decide using their characterization (W4.2) — never via current() !== undefined.
 */
async function foldBindResult(args: {
  r: BindResult;
  policy: ConvergencePolicy<DrainCapability>;
  budget: DrainBudgetHandle | null;
  bind: () => Promise<BindResult>;
  log: Logger;
  axis: "contract" | "build" | null;
  releaseHeld: () => void;
  endpointProbe: () => Promise<AnyConvergenceProbe | null>;
  expected: ConvergenceIdentity;
  /** When set, used as the pre-bind running identity for unverifiable messages. */
  priorRunning?: ConvergenceIdentity;
}): Promise<ConvergenceOutcome> {
  const { r } = args;
  if (r.kind !== "adopted-resident") {
    return bindOutcomeFromResult(r);
  }
  if (r.characterization === null) {
    // Held but uncharacterizable — release so refused/adopted:false matches reality (W4.2).
    args.releaseHeld();
    return identityUnverifiable({
      running: args.priorRunning ?? args.expected,
      expected: args.expected,
      log: args.log,
    });
  }
  // Build a plain probe face from characterization for decide/evaluate.
  const synth: PlainProbe = {
    capability: "not-drainable",
    identity: r.characterization.identity,
    instanceKey: r.characterization.instanceKey,
    dispose() {},
  };
  // If policy is drainable and we need drain, we need a full probe of the held
  // daemon (fireDrain/awaitExit). Re-probe via endpoint for drainable path.
  return evaluateObservedIdentity({
    identity: r.characterization.identity,
    instanceKey: r.characterization.instanceKey,
    policy: args.policy,
    budget: args.budget,
    bindResult: r,
    log: args.log,
    axis: args.axis,
    bind: args.bind,
    releaseHeld: args.releaseHeld,
    endpointProbe: args.endpointProbe,
    expected: args.expected,
    // Prefer a live drainable probe when the policy needs drain.
    getDrainableProbe: async () => {
      const a = await attemptProbe(args.endpointProbe, args.expected, args.log);
      if (a.kind === "probe-failed") return a;
      if (a.kind === "absent") return { kind: "absent" as const };
      if (a.probe.capability !== "drainable") {
        a.probe.dispose();
        return { kind: "absent" as const };
      }
      return { kind: "probe" as const, probe: a.probe };
    },
    synth,
  });
}

/**
 * W4.3: every newly observed identity is an input to decide(policy, identity).
 * Enter budget/drain ONLY when decide says drain-and-replace.
 */
async function evaluateObservedIdentity(args: {
  identity: ConvergenceIdentity;
  instanceKey: InstanceKey;
  policy: ConvergencePolicy<DrainCapability>;
  budget: DrainBudgetHandle | null;
  bindResult: BindResult;
  log: Logger;
  axis: "contract" | "build" | null;
  bind: () => Promise<BindResult>;
  releaseHeld: () => void;
  endpointProbe: () => Promise<AnyConvergenceProbe | null>;
  expected: ConvergenceIdentity;
  getDrainableProbe: () => Promise<
    | { kind: "probe"; probe: DrainableProbe }
    | { kind: "absent" }
    | { kind: "probe-failed"; outcome: ConvergenceOutcome }
  >;
  synth: PlainProbe;
}): Promise<ConvergenceOutcome> {
  const decision = decide(args.policy, args.identity);
  const skewCtx = {
    runningContract: args.identity.contractVersion,
    mineContract: args.expected.contractVersion,
    runningBuild: buildLabel(args.identity.build),
    mineBuild: buildLabel(args.expected.build),
  };

  switch (decision.kind) {
    case "spawn":
    case "adopt":
      return { kind: "adopted" };

    case "report-mismatch":
      return {
        kind: "mismatch-reported",
        running: decision.running,
        bind: args.bindResult,
      };

    case "refuse": {
      // Leave the daemon process standing, but drop OUR held connection so
      // adopted:false matches ep.current() (W4.2).
      args.releaseHeld();
      const detail =
        `convergence: REFUSING a skewed survivor — left standing + degraded, never touched ` +
        `(running contract ${args.identity.contractVersion}, mine ${args.expected.contractVersion})`;
      args.log.warn(skewCtx, detail);
      return {
        kind: "refused",
        adopted: false,
        anomaly: {
          kind: "skew-refused",
          running: args.identity,
          expected: args.expected,
          detail,
        },
      };
    }

    case "recycle": {
      // Already holding a resident — recycle via ensure/bind path.
      return { kind: "recycled", bind: await args.bind() };
    }

    case "drain-and-replace": {
      if (args.budget === null || args.policy.capability !== "drainable") {
        throw new Error(
          "convergence: drain-and-replace without drain budget — unreachable by Pin 1",
        );
      }
      const got = await args.getDrainableProbe();
      if (got.kind === "probe-failed") return got.outcome;
      if (got.kind === "absent") {
        args.releaseHeld();
        return identityUnverifiable({
          running: args.identity,
          expected: args.expected,
          log: args.log,
        });
      }
      try {
        return await enactDrainLoop({
          initialProbe: got.probe,
          axis: decision.axis,
          policy: args.policy as ConvergencePolicy<"drainable">,
          budget: args.budget,
          bind: args.bind,
          log: args.log,
          skewCtx,
          endpointProbe: args.endpointProbe,
          releaseHeld: args.releaseHeld,
          expected: args.expected,
        });
      } finally {
        // enactDrainLoop may promote ownership of successor probes; dispose
        // only if still the initial (not reassigned into loop ownership).
        // enactDrainLoop always disposes owned successors; initial is owned by
        // the caller when disposeInitial is false. We dispose here.
        got.probe.dispose();
      }
    }

    default: {
      const _e: never = decision;
      throw new Error(`unreachable decision: ${JSON.stringify(_e)}`);
    }
  }
}

async function enactDecision(args: {
  decision: ReturnType<typeof decide>;
  running: ConvergenceIdentity;
  instanceKey: InstanceKey;
  probe: AnyConvergenceProbe;
  policy: ConvergencePolicy<DrainCapability>;
  budget: DrainBudgetHandle | null;
  bind: () => Promise<BindResult>;
  log: Logger;
  releaseHeld: () => void;
  endpointProbe: () => Promise<AnyConvergenceProbe | null>;
  disposeInitialProbe: boolean;
}): Promise<ConvergenceOutcome> {
  const baked = args.policy.baked;
  const skewCtx = {
    runningContract: args.running.contractVersion,
    mineContract: baked.contractVersion,
    runningBuild: buildLabel(args.running.build),
    mineBuild: buildLabel(baked.build),
  };

  switch (args.decision.kind) {
    case "spawn":
    case "adopt": {
      const r = await args.bind();
      return foldBindResult({
        r,
        policy: args.policy,
        budget: args.budget,
        bind: args.bind,
        log: args.log,
        axis: null,
        releaseHeld: args.releaseHeld,
        endpointProbe: args.endpointProbe,
        expected: baked,
        priorRunning: args.running,
      });
    }
    case "recycle": {
      args.log.warn(
        skewCtx,
        "convergence: recycling a contract-skewed survivor (kill + respawn)",
      );
      return { kind: "recycled", bind: await args.bind() };
    }
    case "refuse": {
      const detail =
        `convergence: REFUSING a skewed survivor — left standing + degraded, never touched ` +
        `(running contract ${args.running.contractVersion}, mine ${baked.contractVersion})`;
      args.log.warn(skewCtx, detail);
      // Do not adopt a refused resident via bind — leave standing, no hold.
      return {
        kind: "refused",
        adopted: false,
        anomaly: {
          kind: "skew-refused",
          running: args.running,
          expected: baked,
          detail,
        },
      };
    }
    case "drain-and-replace": {
      if (args.probe.capability !== "drainable") {
        throw new Error(
          "convergence: drain-and-replace decided for a non-drainable probe — unreachable by Pin 1",
        );
      }
      if (args.policy.capability !== "drainable" || args.budget === null) {
        throw new Error(
          "convergence: drain-and-replace decided without a drain budget — unreachable by Pin 1",
        );
      }
      return enactDrainLoop({
        initialProbe: args.probe,
        axis: args.decision.axis,
        policy: args.policy as ConvergencePolicy<"drainable">,
        budget: args.budget,
        bind: args.bind,
        log: args.log,
        skewCtx,
        endpointProbe: args.endpointProbe,
        releaseHeld: args.releaseHeld,
        expected: baked,
      });
    }
    case "report-mismatch": {
      return {
        kind: "mismatch-reported",
        running: args.decision.running,
        bind: await args.bind(),
      };
    }
    default: {
      const _exhaustive: never = args.decision;
      throw new Error(
        `unreachable convergence decision: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * F1(a): budget-gated drain → bind → re-probe loop.
 * W4.3: every successor is re-decided before any further drain admission.
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
  releaseHeld: () => void;
  expected: ConvergenceIdentity;
}): Promise<ConvergenceOutcome> {
  const baked = args.policy.baked;
  let current: DrainableProbe = args.initialProbe;
  let axis = args.axis;
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
          releaseHeld: args.releaseHeld,
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
          releaseHeld: args.releaseHeld,
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
          releaseHeld: args.releaseHeld,
        });
      }

      // adopted-resident after drain — characterize via held identity or re-probe (W4.2/W4.4).
      if (r.characterization !== null) {
        const decision = decide(args.policy, r.characterization.identity);
        if (decision.kind === "adopt" || decision.kind === "spawn") {
          return {
            kind: "drained-replacing",
            axis,
            running: current.identity,
            bind: r,
          };
        }
        if (decision.kind === "report-mismatch") {
          return {
            kind: "mismatch-reported",
            running: decision.running,
            bind: r,
          };
        }
        if (decision.kind === "refuse") {
          args.releaseHeld();
          const detail =
            `convergence: REFUSING a post-drain successor — left standing + degraded ` +
            `(running contract ${r.characterization.identity.contractVersion}, mine ${baked.contractVersion})`;
          args.log.warn(args.skewCtx, detail);
          return {
            kind: "refused",
            adopted: false,
            anomaly: {
              kind: "skew-refused",
              running: r.characterization.identity,
              expected: baked,
              detail,
            },
          };
        }
        if (decision.kind === "recycle") {
          return { kind: "recycled", bind: await args.bind() };
        }
        // drain-and-replace on the characterized successor — need a drainable
        // probe to continue. Re-probe and re-decide THAT observation (W4.3).
        if (decision.kind === "drain-and-replace") {
          const next = await attemptProbe(args.endpointProbe, baked, args.log);
          if (next.kind === "probe-failed") {
            args.releaseHeld();
            return next.outcome;
          }
          if (next.kind === "absent" || next.probe.capability !== "drainable") {
            if (next.kind === "probe") next.probe.dispose();
            args.releaseHeld();
            return identityUnverifiable({
              running: r.characterization.identity,
              expected: baked,
              log: args.log,
            });
          }
          const nextDecision = decide(args.policy, next.probe.identity);
          if (nextDecision.kind === "adopt" || nextDecision.kind === "spawn") {
            next.probe.dispose();
            return {
              kind: "drained-replacing",
              axis,
              running: current.identity,
              bind: r,
            };
          }
          if (nextDecision.kind === "report-mismatch") {
            const running = next.probe.identity;
            next.probe.dispose();
            return {
              kind: "mismatch-reported",
              running,
              bind: r,
            };
          }
          if (nextDecision.kind === "refuse") {
            const running = next.probe.identity;
            next.probe.dispose();
            args.releaseHeld();
            const detail =
              `convergence: REFUSING a post-drain successor — left standing + degraded ` +
              `(running contract ${running.contractVersion}, mine ${baked.contractVersion})`;
            args.log.warn(args.skewCtx, detail);
            return {
              kind: "refused",
              adopted: false,
              anomaly: {
                kind: "skew-refused",
                running,
                expected: baked,
                detail,
              },
            };
          }
          if (nextDecision.kind === "recycle") {
            next.probe.dispose();
            return { kind: "recycled", bind: await args.bind() };
          }
          // drain-and-replace again — promote and loop.
          owned?.dispose();
          owned = next.probe;
          current = next.probe;
          axis = nextDecision.axis;
          continue;
        }
        const _never: never = decision;
        throw new Error(`unreachable: ${JSON.stringify(_never)}`);
      }

      // No characterization on bind — re-probe (W4.4).
      const successor = await attemptProbe(args.endpointProbe, baked, args.log);
      if (successor.kind === "probe-failed") {
        args.releaseHeld();
        return successor.outcome;
      }
      if (successor.kind === "absent") {
        args.releaseHeld();
        return identityUnverifiable({
          running: current.identity,
          expected: baked,
          log: args.log,
        });
      }

      // W4.3: re-decide the successor before any further drain.
      const decision = decide(args.policy, successor.probe.identity);
      if (decision.kind === "adopt" || decision.kind === "spawn") {
        successor.probe.dispose();
        return {
          kind: "drained-replacing",
          axis,
          running: current.identity,
          bind: r,
        };
      }
      if (decision.kind === "report-mismatch") {
        const running = successor.probe.identity;
        successor.probe.dispose();
        return {
          kind: "mismatch-reported",
          running,
          bind: r,
        };
      }
      if (decision.kind === "refuse") {
        const running = successor.probe.identity;
        successor.probe.dispose();
        args.releaseHeld();
        const detail =
          `convergence: REFUSING a post-drain successor — left standing + degraded ` +
          `(running contract ${running.contractVersion}, mine ${baked.contractVersion})`;
        args.log.warn(args.skewCtx, detail);
        return {
          kind: "refused",
          adopted: false,
          anomaly: {
            kind: "skew-refused",
            running,
            expected: baked,
            detail,
          },
        };
      }
      if (decision.kind === "recycle") {
        successor.probe.dispose();
        return { kind: "recycled", bind: await args.bind() };
      }
      // drain-and-replace — continue loop only if drainable.
      if (successor.probe.capability !== "drainable") {
        successor.probe.dispose();
        throw new Error(
          "convergence: post-drain successor needs drain but is not drainable — unreachable by Pin 1",
        );
      }
      owned?.dispose();
      owned = successor.probe;
      current = successor.probe;
      axis = decision.axis;
    }
  } finally {
    owned?.dispose();
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
  releaseHeld: () => void;
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
      // Stale ride: we intentionally keep the held resident.
      return { kind: "adopted-stale", anomaly: g.anomaly };
    }
    if (r.kind === "spawned-fresh") {
      return { kind: "spawned-fresh" };
    }
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
  // refuse give-up — do not hold a connection (W4.2 agreement).
  args.releaseHeld();
  return { kind: "refused", adopted: false, anomaly: g.anomaly };
}

export { instanceKeyFromStartedAt };
