/**
 * `converge(endpoint)` — the endpoint-arm enactment of the kit. The ONLY boot verb on
 * an endpoint: probe → decide → budget-gated drain → private bind methods.
 *
 * Accepts only a genuine {@link createEndpoint} handle (F12 WeakMap brand).
 *
 * **W5 — single observation authority (`foldObserved`).** Every observed identity
 * (initial probe, bind characterization, post-drain successor, post-give-up bind,
 * drainable re-probe) flows through that function alone:
 *   1. folds through `decide(policy, identity)` — never a hand-copied subset;
 *   2. owns connection lifecycle — non-adopt returns have released any hold;
 *   3. preserves three-valued observations (identity | absent | failed);
 *   4. reports `running: null` when unknown (never fabricates expected).
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
import { decide, type Decision } from "./decide.ts";
import { giveUpOutcome } from "./giveUp.ts";
import { type InstanceKey, instanceKeyFromStartedAt } from "./instanceKey.ts";
import type { ConvergencePolicy, DrainCapability } from "./policy.ts";
import { endpointPrivate } from "../endpoint.private.ts";
import type { Endpoint } from "../endpoint.ts";

export interface ConvergenceProbeBase {
  readonly identity: ConvergenceIdentity;
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

// ── Observation model ───────────────────────────────────────────────────────

type Observation =
  | {
      readonly kind: "identity";
      readonly identity: ConvergenceIdentity;
      readonly instanceKey: InstanceKey;
      readonly drainable: DrainableProbe | null;
      readonly dispose: () => void;
    }
  | { readonly kind: "absent" }
  | { readonly kind: "failed"; readonly message: string };

type FoldCtx = {
  readonly policy: ConvergencePolicy<DrainCapability>;
  readonly budget: DrainBudgetHandle | null;
  readonly expected: ConvergenceIdentity;
  readonly log: Logger;
  readonly bind: () => Promise<BindResult>;
  readonly releaseHeld: () => void;
  holding: boolean;
  lastKnownRunning: ConvergenceIdentity | null;
  resolveDrainable: () => Promise<Observation>;
  heldBind: BindResult | null;
  /**
   * When non-null, the drain budget is already spent (give-up path). decide still
   * folds every identity; enactment of drain-and-replace / adopt / spawn rides
   * the held resident as adopted-stale instead of re-entering the drain loop.
   */
  rideStale: Extract<ConvergenceAnomaly, { kind: "adopted-stale" }> | null;
};

function lineageOf(
  identity: ConvergenceIdentity,
  instanceKey: InstanceKey,
): DrainLineage {
  return { build: identity.build, instanceKey };
}

function skewCtxOf(
  running: ConvergenceIdentity,
  expected: ConvergenceIdentity,
): Record<string, string> {
  return {
    runningContract: running.contractVersion,
    mineContract: expected.contractVersion,
    runningBuild: buildLabel(running.build),
    mineBuild: buildLabel(expected.build),
  };
}

async function observeProbe(
  run: () => Promise<AnyConvergenceProbe | null>,
): Promise<Observation> {
  try {
    const p = await run();
    if (p === null) return { kind: "absent" };
    return {
      kind: "identity",
      identity: p.identity,
      instanceKey: p.instanceKey,
      drainable: p.capability === "drainable" ? p : null,
      dispose: () => p.dispose(),
    };
  } catch (err) {
    return {
      kind: "failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function observationFromCharacterization(
  c: Extract<BindResult, { kind: "adopted-resident" }>["characterization"],
): Observation {
  switch (c.kind) {
    case "characterized":
      return {
        kind: "identity",
        identity: c.identity,
        instanceKey: c.instanceKey,
        drainable: null,
        dispose: () => {},
      };
    case "absent":
    case "uncorrelated":
      return { kind: "absent" };
    case "failed":
      return { kind: "failed", message: c.message };
    default: {
      const _e: never = c;
      throw new Error(`unreachable characterization: ${JSON.stringify(_e)}`);
    }
  }
}

function probeFailedOutcome(args: {
  message: string;
  expected: ConvergenceIdentity;
  running: ConvergenceIdentity | null;
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
      running: args.running,
      expected: args.expected,
      cause,
      detail,
    },
  };
}

function identityUnverifiableOutcome(args: {
  running: ConvergenceIdentity | null;
  expected: ConvergenceIdentity;
  log: Logger;
}): ConvergenceOutcome {
  const cause = { kind: "identity-unverifiable" as const };
  const runLabel =
    args.running === null ? "unknown" : buildLabel(args.running.build);
  const detail =
    `bound a resident whose identity the probe could not re-characterize ` +
    `(running was ${runLabel}; expected ${buildLabel(args.expected.build)})`;
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

/** Drop hold if set — lifecycle side of non-adopt returns. */
function dropHold(ctx: FoldCtx): void {
  if (ctx.holding) {
    ctx.releaseHeld();
    ctx.holding = false;
  }
}

/**
 * THE single authority. Every observed identity / failure / absence that
 * participates in a convergence decision routes here.
 */
async function foldObserved(
  obs: Observation,
  ctx: FoldCtx,
): Promise<ConvergenceOutcome> {
  if (obs.kind === "failed") {
    dropHold(ctx);
    return probeFailedOutcome({
      message: obs.message,
      expected: ctx.expected,
      running: ctx.lastKnownRunning,
      log: ctx.log,
    });
  }

  if (obs.kind === "absent") {
    if (ctx.holding) {
      dropHold(ctx);
      return identityUnverifiableOutcome({
        running: ctx.lastKnownRunning,
        expected: ctx.expected,
        log: ctx.log,
      });
    }
    return { kind: "not-adopted" };
  }

  ctx.lastKnownRunning = obs.identity;
  return enactDecision(decide(ctx.policy, obs.identity), obs, ctx);
}

async function enactDecision(
  decision: Decision,
  obs: Extract<Observation, { kind: "identity" }>,
  ctx: FoldCtx,
): Promise<ConvergenceOutcome> {
  const skew = skewCtxOf(obs.identity, ctx.expected);

  // Budget already spent (give-up): decide still owns the fold; only enactment
  // of "keep riding" arms differs — never re-enter the drain loop.
  if (ctx.rideStale !== null) {
    switch (decision.kind) {
      case "spawn":
      case "adopt":
      case "drain-and-replace":
        return { kind: "adopted-stale", anomaly: ctx.rideStale };
      case "report-mismatch":
        return {
          kind: "mismatch-reported",
          running: decision.running,
          bind:
            ctx.heldBind ??
            ({
              kind: "adopted-resident",
              characterization: {
                kind: "characterized",
                identity: obs.identity,
                instanceKey: obs.instanceKey,
              },
            } satisfies BindResult),
        };
      case "refuse": {
        dropHold(ctx);
        const detail =
          `convergence: REFUSING give-up bind resident — left standing + degraded ` +
          `(running contract ${obs.identity.contractVersion}, mine ${ctx.expected.contractVersion})`;
        ctx.log.warn(skew, detail);
        return {
          kind: "refused",
          adopted: false,
          anomaly: {
            kind: "skew-refused",
            running: obs.identity,
            expected: ctx.expected,
            detail,
          },
        };
      }
      case "recycle":
        return { kind: "recycled", bind: await ctx.bind() };
      default: {
        const _e: never = decision;
        throw new Error(`unreachable decision: ${JSON.stringify(_e)}`);
      }
    }
  }

  switch (decision.kind) {
    case "spawn":
    case "adopt":
      return { kind: "adopted" };

    case "report-mismatch": {
      const bind: BindResult =
        ctx.heldBind ??
        ({
          kind: "adopted-resident",
          characterization: {
            kind: "characterized",
            identity: obs.identity,
            instanceKey: obs.instanceKey,
          },
        } satisfies BindResult);
      return {
        kind: "mismatch-reported",
        running: decision.running,
        bind,
      };
    }

    case "refuse": {
      dropHold(ctx);
      const detail =
        `convergence: REFUSING a skewed survivor — left standing + degraded, never touched ` +
        `(running contract ${obs.identity.contractVersion}, mine ${ctx.expected.contractVersion})`;
      ctx.log.warn(skew, detail);
      return {
        kind: "refused",
        adopted: false,
        anomaly: {
          kind: "skew-refused",
          running: obs.identity,
          expected: ctx.expected,
          detail,
        },
      };
    }

    case "recycle":
      return { kind: "recycled", bind: await ctx.bind() };

    case "drain-and-replace": {
      if (ctx.budget === null || ctx.policy.capability !== "drainable") {
        throw new Error(
          "convergence: drain-and-replace without drain budget — unreachable by Pin 1",
        );
      }

      // Need drainable probe. If missing, resolve then re-fold (re-decide).
      if (obs.drainable === null) {
        const resolved = await ctx.resolveDrainable();
        obs.dispose();
        return foldObserved(resolved, ctx);
      }

      // Loop takes ownership of this drainable (disposes via disposeInitial).
      return enactDrainLoop({
        initial: obs.drainable,
        disposeInitial: obs.dispose,
        axis: decision.axis,
        policy: ctx.policy as ConvergencePolicy<"drainable">,
        budget: ctx.budget,
        bind: ctx.bind,
        log: ctx.log,
        expected: ctx.expected,
        // Unconditional release (give-up bind may hold without ctx.holding set).
        releaseHeld: () => {
          ctx.releaseHeld();
          ctx.holding = false;
        },
        resolveDrainable: ctx.resolveDrainable,
        baseCtx: ctx,
      });
    }

    default: {
      const _e: never = decision;
      throw new Error(`unreachable decision: ${JSON.stringify(_e)}`);
    }
  }
}

async function foldBindResult(
  r: BindResult,
  ctx: FoldCtx,
): Promise<ConvergenceOutcome> {
  switch (r.kind) {
    case "spawned-fresh":
      ctx.holding = true;
      ctx.heldBind = r;
      return { kind: "spawned-fresh" };
    case "refused-or-failed":
      return { kind: "not-adopted" };
    case "adopted-resident": {
      ctx.holding = true;
      ctx.heldBind = r;
      return foldObserved(
        observationFromCharacterization(r.characterization),
        ctx,
      );
    }
    default: {
      const _e: never = r;
      throw new Error(`unreachable BindResult: ${JSON.stringify(_e)}`);
    }
  }
}

// ── Drain loop ──────────────────────────────────────────────────────────────

async function enactDrainLoop(args: {
  initial: DrainableProbe;
  disposeInitial: () => void;
  axis: "contract" | "build";
  policy: ConvergencePolicy<"drainable">;
  budget: DrainBudgetHandle;
  bind: () => Promise<BindResult>;
  log: Logger;
  expected: ConvergenceIdentity;
  releaseHeld: () => void;
  resolveDrainable: () => Promise<Observation>;
  baseCtx: FoldCtx;
}): Promise<ConvergenceOutcome> {
  const baked = args.expected;
  let current = args.initial;
  let axis = args.axis;

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
          policy: args.policy,
          releaseHeld: args.releaseHeld,
          baseCtx: args.baseCtx,
        });
      }

      args.log.info(
        {
          axis,
          attempt: admission.attempt,
          ...skewCtxOf(current.identity, baked),
        },
        "convergence: draining a superseded survivor (persist + exit; its children survive) and respawning our own build",
      );
      const drain = await drainAndAwaitExit(
        () => current.fireDrain(),
        (signal) => current.awaitExit(signal),
        { ceilingMs: current.drainCeilingMs },
      );
      if (!drain.took) {
        args.log.error(
          { axis, ...skewCtxOf(current.identity, baked) },
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
          policy: args.policy,
          drainNotTaken: {
            ceilingMs: current.drainCeilingMs,
            rejection: drain.drainRejection,
          },
          releaseHeld: args.releaseHeld,
          baseCtx: args.baseCtx,
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
        args.releaseHeld();
        return {
          kind: "refused",
          adopted: false,
          anomaly: {
            kind: "unconverged",
            running: current.identity,
            expected: baked,
            cause: { kind: "adopt-bind-failed", axis },
            detail:
              "bind refused or failed after admitted drain of bound resident",
          },
        };
      }

      // adopted-resident — fold through the single authority.
      // That may re-enter drain (nested enactDrainLoop) if decide says drain again
      // and a drainable probe is resolved — correct recursive structure.
      args.baseCtx.holding = true;
      args.baseCtx.heldBind = r;
      args.baseCtx.lastKnownRunning = current.identity;
      const folded = await foldBindResult(r, args.baseCtx);

      if (folded.kind === "adopted") {
        return {
          kind: "drained-replacing",
          axis,
          running: current.identity,
          bind: r,
        };
      }

      // Authority returned a terminal outcome (refuse / mismatch / unconverged /
      // nested drained-replacing / adopted-stale / recycled). For nested drain,
      // foldObserved already ran a full enactDrainLoop — trust the result.
      //
      // Special case: if fold re-entered drain via resolveDrainable and returned
      // a recursive outcome, we're done. If fold returned adopted-stale etc., done.
      //
      // We do NOT continue the outer loop after foldBindResult — the authority
      // owns the successor transition. That means nested drain handles multi-step
      // same-lineage continuation.
      return folded;
    }
  } finally {
    args.disposeInitial();
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
  policy: ConvergencePolicy<DrainCapability>;
  drainNotTaken?: { ceilingMs: number; rejection: string | null };
  releaseHeld: () => void;
  baseCtx: FoldCtx;
}): Promise<ConvergenceOutcome> {
  const g = giveUpOutcome({
    admission: args.admission,
    onGiveUp: args.onGiveUp,
    axis: args.axis,
    running: args.running,
    expected: args.expected,
    log: args.log,
    skewCtx: skewCtxOf(args.running, args.expected),
    logPrefix: "convergence",
    drainNotTaken: args.drainNotTaken,
  });

  if (g.kind === "adopt-stale") {
    const r = await args.bind();
    if (r.kind === "refused-or-failed") {
      return {
        kind: "refused",
        adopted: false,
        anomaly: {
          kind: "unconverged",
          running: args.running,
          expected: args.expected,
          cause: { kind: "adopt-bind-failed", axis: args.axis },
          detail: g.anomaly.detail,
        },
      };
    }
    // Single authority: fold the bind characterization with rideStale so
    // decide still owns the fold, but drain is never re-enacted.
    args.baseCtx.rideStale = g.anomaly;
    args.baseCtx.lastKnownRunning = args.running;
    return foldBindResult(r, args.baseCtx);
  }

  args.releaseHeld();
  return { kind: "refused", adopted: false, anomaly: g.anomaly };
}

// ── Public entry ────────────────────────────────────────────────────────────

export async function converge<
  C,
  I,
  M = undefined,
  Cap extends DrainCapability = DrainCapability,
>(endpoint: Endpoint<C, I, M, Cap>): Promise<ConvergenceOutcome> {
  const binds = endpointPrivate(endpoint);
  const policy = endpoint.policy;
  const expected = policy.baked;

  const releaseHeld = (): void => binds.releaseHeld();
  const bind =
    policy.onContractSkew.kind === "recycle"
      ? () => binds.adoptOrEnsure()
      : () => binds.adoptOrSpawnOrRefuse();

  const resolveDrainable = (): Promise<Observation> =>
    observeProbe(() => endpoint.probe());

  const ctx: FoldCtx = {
    policy,
    budget: endpoint.budget,
    expected,
    log: endpoint.log,
    bind,
    releaseHeld,
    holding: false,
    lastKnownRunning: null,
    resolveDrainable,
    heldBind: null,
    rideStale: null,
  };

  const initial = await observeProbe(() => endpoint.probe());

  // Absent primary → bind, then fold the bind characterization through the
  // single authority (same path as every other identity observation).
  if (initial.kind === "absent") {
    return foldBindResult(await bind(), ctx);
  }

  // Failed probe → foldObserved (running-unknown: lastKnownRunning is null).
  if (initial.kind === "failed") {
    return foldObserved(initial, ctx);
  }

  // Identity observation. foldObserved may transfer drainable ownership into
  // enactDrainLoop (which calls disposeInitial). Track whether dispose is owed.
  let disposed = false;
  const disposeOnce = (): void => {
    if (!disposed) {
      disposed = true;
      initial.dispose();
    }
  };

  // Wrap dispose so enactDrainLoop's disposeInitial uses disposeOnce.
  const obs: Observation = {
    kind: "identity",
    identity: initial.identity,
    instanceKey: initial.instanceKey,
    drainable: initial.drainable,
    dispose: disposeOnce,
  };

  try {
    const out = await foldObserved(obs, ctx);

    if (out.kind === "adopted" && !ctx.holding) {
      return foldBindResult(await bind(), ctx);
    }

    if (out.kind === "mismatch-reported" && !ctx.holding) {
      const r = await bind();
      if (r.kind === "adopted-resident") {
        return {
          kind: "mismatch-reported",
          running: out.running,
          bind: r,
        };
      }
      return foldBindResult(r, ctx);
    }

    return out;
  } finally {
    disposeOnce();
  }
}

export { instanceKeyFromStartedAt };
