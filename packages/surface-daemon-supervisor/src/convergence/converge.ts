/**
 * `converge(endpoint)` — the endpoint-arm enactment of the kit. The ONLY boot verb on
 * an endpoint: probe → decide → budget-gated drain → private bind methods.
 *
 * Accepts only a genuine {@link createEndpoint} handle (F12 WeakMap brand).
 *
 * **Single observation authority (`foldObserved`).** Every observed identity
 * (initial probe, bind characterization, post-drain successor, post-give-up bind,
 * drainable re-probe) and every bind transition routes through that function:
 *   1. folds through `decide(policy, identity | null)` — never a hand-copied subset;
 *   2. owns connection lifecycle — refused / not-adopted / probe-failed always call
 *      the idempotent `releaseHeld` (no `holding` mirror);
 *   3. preserves four-valued characterizations (characterized | absent | failed |
 *      uncorrelated);
 *   4. reports `running: null` when unknown (never fabricates expected);
 *   5. owns dispose of every identity observation (transfer only into drain loop).
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
import {
  type InstanceKey,
  instanceKeyFromStartedAt,
  instanceKeyTag,
} from "./instanceKey.ts";
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

/**
 * Four-valued observation. `bound` distinguishes a probe-origin observation
 * (may still need a bind) from a characterization of an already-held connection
 * — encoded here so the fold never consults a separate `holding` mirror.
 */
type Observation =
  | {
      readonly kind: "identity";
      readonly identity: ConvergenceIdentity;
      readonly instanceKey: InstanceKey;
      readonly drainable: DrainableProbe | null;
      readonly dispose: () => void;
      /** True when this identity came from a held bind's characterization. */
      readonly bound: boolean;
    }
  | {
      readonly kind: "absent";
      /** True when a held bind's characterization was empty (unverifiable). */
      readonly bound: boolean;
    }
  | { readonly kind: "uncorrelated" }
  | { readonly kind: "failed"; readonly message: string };

type FoldCtx = {
  readonly policy: ConvergencePolicy<DrainCapability>;
  readonly budget: DrainBudgetHandle | null;
  readonly expected: ConvergenceIdentity;
  readonly log: Logger;
  readonly bind: () => Promise<BindResult>;
  readonly releaseHeld: () => void;
  lastKnownRunning: ConvergenceIdentity | null;
  resolveDrainable: () => Promise<Observation>;
  heldBind: BindResult | null;
  /**
   * When non-null, the drain budget is already spent (give-up path). decide still
   * folds every identity; enactment of drain-and-replace rides adopted-stale,
   * while a clean `adopt` returns adopted (W6.6).
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
    if (p === null) return { kind: "absent", bound: false };
    return {
      kind: "identity",
      identity: p.identity,
      instanceKey: p.instanceKey,
      drainable: p.capability === "drainable" ? p : null,
      dispose: () => p.dispose(),
      bound: false,
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
        bound: true,
      };
    case "absent":
      return { kind: "absent", bound: true };
    case "uncorrelated":
      return { kind: "uncorrelated" };
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
  releaseHeld: () => void;
}): ConvergenceOutcome {
  args.releaseHeld();
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
  releaseHeld: () => void;
}): ConvergenceOutcome {
  args.releaseHeld();
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

function skewRefusedOutcome(args: {
  running: ConvergenceIdentity;
  expected: ConvergenceIdentity;
  log: Logger;
  releaseHeld: () => void;
  detail: string;
}): ConvergenceOutcome {
  args.releaseHeld();
  args.log.warn(skewCtxOf(args.running, args.expected), args.detail);
  return {
    kind: "refused",
    adopted: false,
    anomaly: {
      kind: "skew-refused",
      running: args.running,
      expected: args.expected,
      detail: args.detail,
    },
  };
}

/**
 * THE single authority. Every observation and every bind transition that
 * participates in a convergence decision routes here.
 */
async function foldObserved(
  obs: Observation,
  ctx: FoldCtx,
): Promise<ConvergenceOutcome> {
  if (obs.kind === "failed") {
    return probeFailedOutcome({
      message: obs.message,
      expected: ctx.expected,
      running: ctx.lastKnownRunning,
      log: ctx.log,
      releaseHeld: ctx.releaseHeld,
    });
  }

  if (obs.kind === "uncorrelated") {
    return identityUnverifiableOutcome({
      running: ctx.lastKnownRunning,
      expected: ctx.expected,
      log: ctx.log,
      releaseHeld: ctx.releaseHeld,
    });
  }

  if (obs.kind === "absent") {
    if (obs.bound) {
      return identityUnverifiableOutcome({
        running: ctx.lastKnownRunning,
        expected: ctx.expected,
        log: ctx.log,
        releaseHeld: ctx.releaseHeld,
      });
    }
    // Probe-origin absence → decide(null) → spawn/bind via the authority.
    return enactDecision(decide(ctx.policy, null), null, ctx);
  }

  // Identity: foldObserved owns dispose unless transferred into the drain loop.
  let transferred = false;
  try {
    ctx.lastKnownRunning = obs.identity;
    return await enactDecision(decide(ctx.policy, obs.identity), obs, ctx, {
      transferDispose: () => {
        transferred = true;
      },
    });
  } finally {
    if (!transferred) obs.dispose();
  }
}

async function enactDecision(
  decision: Decision,
  obs: Extract<Observation, { kind: "identity" }> | null,
  ctx: FoldCtx,
  dispose?: { transferDispose: () => void },
): Promise<ConvergenceOutcome> {
  // Budget already spent (give-up): decide still owns the fold.
  if (ctx.rideStale !== null) {
    switch (decision.kind) {
      case "spawn":
      case "adopt":
        // W6.6: exact match after give-up is clean adopted, not mislabeled stale.
        return { kind: "adopted" };
      case "drain-and-replace":
        return { kind: "adopted-stale", anomaly: ctx.rideStale };
      case "report-mismatch": {
        if (obs === null) {
          throw new Error(
            "convergence: report-mismatch without identity observation",
          );
        }
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
      }
      case "refuse": {
        if (obs === null) {
          throw new Error("convergence: refuse without identity observation");
        }
        return skewRefusedOutcome({
          running: obs.identity,
          expected: ctx.expected,
          log: ctx.log,
          releaseHeld: ctx.releaseHeld,
          detail:
            `convergence: REFUSING give-up bind resident — left standing + degraded ` +
            `(running contract ${obs.identity.contractVersion}, mine ${ctx.expected.contractVersion})`,
        });
      }
      case "recycle": {
        const r = await ctx.bind();
        const folded = await foldBindResult(r, ctx);
        if (folded.kind === "spawned-fresh") {
          return { kind: "recycled", bind: r };
        }
        return folded;
      }
      default: {
        const _e: never = decision;
        throw new Error(`unreachable decision: ${JSON.stringify(_e)}`);
      }
    }
  }

  switch (decision.kind) {
    case "spawn":
    case "adopt": {
      // Already holding a characterized resident that matches → keep it.
      if (obs?.bound) return { kind: "adopted" };
      // Need a bind; fold its result through the authority (never return bind raw).
      return foldBindResult(await ctx.bind(), ctx);
    }

    case "report-mismatch": {
      if (obs === null) {
        throw new Error(
          "convergence: report-mismatch without identity observation",
        );
      }
      // Already holding — report against the held characterization.
      if (obs.bound && ctx.heldBind !== null) {
        return {
          kind: "mismatch-reported",
          running: decision.running,
          bind: ctx.heldBind,
        };
      }
      // Probe-origin mismatch: bind, then re-fold the NEW characterization
      // (never report the stale probe identity over a different held resident).
      return foldBindResult(await ctx.bind(), ctx);
    }

    case "refuse": {
      if (obs === null) {
        throw new Error("convergence: refuse without identity observation");
      }
      return skewRefusedOutcome({
        running: obs.identity,
        expected: ctx.expected,
        log: ctx.log,
        releaseHeld: ctx.releaseHeld,
        detail:
          `convergence: REFUSING a skewed survivor — left standing + degraded, never touched ` +
          `(running contract ${obs.identity.contractVersion}, mine ${ctx.expected.contractVersion})`,
      });
    }

    case "recycle": {
      const r = await ctx.bind();
      const folded = await foldBindResult(r, ctx);
      if (folded.kind === "spawned-fresh") {
        return { kind: "recycled", bind: r };
      }
      return folded;
    }

    case "drain-and-replace": {
      if (ctx.budget === null || ctx.policy.capability !== "drainable") {
        throw new Error(
          "convergence: drain-and-replace without drain budget — unreachable by Pin 1",
        );
      }
      if (obs === null) {
        throw new Error(
          "convergence: drain-and-replace without identity observation",
        );
      }

      // Need drainable probe. If missing, resolve then re-fold (re-decide).
      // Current obs is disposed by foldObserved's finally after we return.
      if (obs.drainable === null) {
        const resolved = await ctx.resolveDrainable();
        return foldObserved(resolved, ctx);
      }

      // Transfer dispose ownership into the drain body.
      dispose?.transferDispose();
      return enactDrainOnce({
        initial: obs.drainable,
        disposeInitial: obs.dispose,
        axis: decision.axis,
        policy: ctx.policy as ConvergencePolicy<"drainable">,
        budget: ctx.budget,
        bind: ctx.bind,
        log: ctx.log,
        expected: ctx.expected,
        releaseHeld: ctx.releaseHeld,
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
      ctx.heldBind = r;
      return { kind: "spawned-fresh" };
    case "refused-or-failed":
      ctx.releaseHeld();
      return { kind: "not-adopted" };
    case "adopted-resident": {
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

// ── Drain enactment (single body; successor re-entry is recursive) ──────────

async function enactDrainOnce(args: {
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
  const current = args.initial;
  const axis = args.axis;

  try {
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

    // adopted-resident — fold through the single authority (may re-enter drain).
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

    // Authority owns the successor transition (recursive drain / refuse / stale).
    return folded;
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
      args.releaseHeld();
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
    // Fold characterization with rideStale (no re-drain; clean adopt if exact).
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
    lastKnownRunning: null,
    resolveDrainable,
    heldBind: null,
    rideStale: null,
  };

  // Every observation — including initial absence and failure — through the
  // single authority. No public-tail bind shortcuts.
  const initial = await observeProbe(() => endpoint.probe());
  return foldObserved(initial, ctx);
}

export { instanceKeyFromStartedAt, instanceKeyTag };
