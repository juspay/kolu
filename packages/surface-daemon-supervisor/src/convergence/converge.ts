/**
 * `converge(endpoint)` — the endpoint-arm enactment of the kit. The ONLY boot verb on
 * an endpoint: it probes the running daemon's identity over a VERSION-AGNOSTIC channel
 * (Pin 3), asks `decide` what to do, admits drain via the per-boot budget (when
 * drainable), enacts through the endpoint's private boot methods, and returns a typed
 * {@link ConvergenceOutcome} with an optional {@link ConvergenceAnomaly}.
 *
 * The consumer states its whole surface once on the endpoint (`policy` — who I am + how
 * I converge, including `baked` and the Cap-gated `drainBudget`). There is no fence
 * object, no boot-method choice, no admit hook at the call site.
 *
 * Enactment maps each decision to an EXISTING endpoint boot method:
 *   - spawn / adopt / report-mismatch / refuse → `adoptOrSpawnOrRefuse` (never-recycle)
 *     or `adoptOrEnsure` (recycle-on-skew), chosen by the policy once.
 *   - recycle                                  → `adoptOrEnsure`.
 *   - drain-and-replace                        → budget-admit → drain → bind; give-up
 *     yields the typed anomaly (`adopted-stale` / `unconverged` / `cross-supervisor`).
 */

import {
  buildLabel,
  type ConvergenceIdentity,
  type Logger,
} from "@kolu/surface-daemon";
import type { ConvergenceAnomaly } from "./anomaly.ts";
import type { DrainBudgetMemory, DrainLineage } from "./budget.ts";
import {
  drainAndAwaitExit,
  drainRejectionSuffix,
} from "./drainAndAwaitExit.ts";
import { decide } from "./decide.ts";
import { giveUpOutcome } from "./giveUp.ts";
import type { ConvergencePolicy, DrainCapability } from "./policy.ts";

/** The endpoint face `converge` enacts through — a Pick of the real `Endpoint` plus the
 *  convergence fields the endpoint stores from its spec. Both the live endpoint and a
 *  test spy satisfy it. */
export interface ConvergingEndpoint<
  Cap extends DrainCapability = DrainCapability,
> {
  /** Adopt a compatible survivor, refuse a skew (→ degraded), or spawn fresh — NEVER
   *  recycles. The never-recycle bind (padi's boot policy). */
  adoptOrSpawnOrRefuse: () => Promise<boolean>;
  /** Recycle a skewed survivor (kill + respawn) then bind — the recycle-on-skew bind
   *  (kaval's boot policy). */
  adoptOrEnsure: () => Promise<boolean>;
  /** The fixed policy stated at endpoint construction. */
  readonly policy: ConvergencePolicy<Cap>;
  /** Probe the running daemon at the endpoint's home (or null if none answers). */
  probe: () => Promise<ConvergenceProbe<Cap> | null>;
  /** Per-boot budget memory (drainable only); null for not-drainable. */
  readonly budget: Cap extends "drainable"
    ? DrainBudgetMemory
    : DrainBudgetMemory | null;
  readonly log: Logger;
}

/** A live probe of a running daemon over its version-agnostic identity channel. `identity`
 *  is read regardless of contract compatibility (Pin 3); `dispose` drops the probe socket.
 *  `instanceKey` feeds the budget (defaults to null when the probe has no instance). */
export interface ConvergenceProbeBase {
  readonly identity: ConvergenceIdentity;
  /** Instance key for the drain budget — typically the fragment's `startedAt`. */
  readonly instanceKey?: string | number | null;
  dispose(): void;
}

/** A drain-capable probe — its handshake exposes a `drain` verb, so a `drain-and-replace`
 *  policy is spellable for it (Pin 1). The probe supplies only the two plugs; the
 *  framework runs {@link drainAndAwaitExit} (same skeleton as `convergeAdmit`). */
export interface DrainableProbe extends ConvergenceProbeBase {
  readonly capability: "drainable";
  /** Fire the daemon's drain verb (fire-and-forget; resolve/reject is not ground truth). */
  fireDrain(): Promise<void>;
  /** Observe that the daemon actually left (socket close, …). Honour the abort signal. */
  awaitExit(signal: AbortSignal): Promise<void>;
  /** Ceiling for the framework's exit-vs-timeout race. */
  readonly drainCeilingMs: number;
}

/** A non-drainable probe — no `drain` verb, so no drain policy can be declared for it. */
export interface PlainProbe extends ConvergenceProbeBase {
  readonly capability: "not-drainable";
}

/** The probe shape for a given capability — `converge` ties the policy's `Cap` to this, so
 *  a drain policy requires a drainable probe (Pin 1). */
export type ConvergenceProbe<Cap extends DrainCapability> =
  Cap extends "drainable" ? DrainableProbe : PlainProbe;

type AnyConvergenceProbe = DrainableProbe | PlainProbe;

/** The typed outcome `converge` returns; the CALLER wires it to its own surfaces/logs.
 *  `anomaly` is set when the bind is degraded (adopted-stale / skew-refused / …);
 *  absence = converged clean. `link-failed` is never produced here (session-owned).
 *
 *  `not-adopted` is DELIBERATELY imprecise: the endpoint's bind methods return only a
 *  boolean (`true` = a survivor was adopted), so a `false` cannot be resolved to "spawned
 *  fresh" vs "found a survivor but left it standing degraded". We report exactly what the
 *  boolean proves — NOT adopted — and never overclaim a `spawned` the endpoint can't
 *  attest. The endpoint surfaces the degraded case itself, loudly, via `onStatus`. */
export type ConvergenceOutcome =
  | {
      readonly kind: "adopted";
      readonly anomaly?: ConvergenceAnomaly;
    }
  | { readonly kind: "not-adopted"; readonly anomaly?: ConvergenceAnomaly }
  | {
      readonly kind: "recycled";
      readonly adopted: boolean;
      readonly anomaly?: ConvergenceAnomaly;
    }
  | {
      readonly kind: "refused";
      readonly adopted: boolean;
      readonly anomaly?: ConvergenceAnomaly;
    }
  | {
      readonly kind: "drained-replacing";
      readonly axis: "contract" | "build";
      /** The drained survivor's identity — so the caller can log its own domain
       *  breadcrumb (e.g. padi's `#1670` build-change line) from the returned outcome. */
      readonly running: ConvergenceIdentity;
      readonly adopted: boolean;
      readonly anomaly?: ConvergenceAnomaly;
    }
  | {
      readonly kind: "mismatch-reported";
      readonly running: ConvergenceIdentity;
      readonly adopted: boolean;
      readonly anomaly?: ConvergenceAnomaly;
    };

/** Whether a survivor was ADOPTED (its children preserved), across every outcome kind —
 *  the one fact a caller's reconcile step keys on. */
export function outcomeAdopted(outcome: ConvergenceOutcome): boolean {
  if (outcome.kind === "adopted") return true;
  if (outcome.kind === "not-adopted") return false;
  return outcome.adopted;
}

/** The standing anomaly on an outcome, if any. */
export function outcomeAnomaly(
  outcome: ConvergenceOutcome,
): ConvergenceAnomaly | undefined {
  return outcome.anomaly;
}

function lineageOf(probe: AnyConvergenceProbe): DrainLineage {
  return {
    build: probe.identity.build,
    instanceKey: probe.instanceKey ?? null,
  };
}

export async function converge<Cap extends DrainCapability>(
  endpoint: ConvergingEndpoint<Cap>,
): Promise<ConvergenceOutcome> {
  const policy = endpoint.policy;
  const baked = policy.baked;
  const probe: AnyConvergenceProbe | null = await endpoint.probe();

  // The bind method is chosen by the POLICY, not the decision: a recycle-on-skew daemon
  // (kaval) binds through `adoptOrEnsure` on EVERY path — so a skew recycles wherever the
  // endpoint finds it, INCLUDING the adopt-hint the single probe never saw (the W2.2
  // legacy-port migration); a refuse/drain daemon (padi) binds through the never-recycle
  // `adoptOrSpawnOrRefuse`.
  const bind =
    policy.onContractSkew.kind === "recycle"
      ? endpoint.adoptOrEnsure
      : endpoint.adoptOrSpawnOrRefuse;

  // No live survivor at the primary → bind (spawn fresh, or — for a recycle-on-skew
  // daemon — adopt/recycle the endpoint's hint).
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
        endpoint.log.warn(
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
        endpoint.log.warn(skewCtx, detail);
        const adopted = await bind();
        return {
          kind: "refused",
          adopted,
          anomaly: {
            kind: "skew-refused",
            running: probe.identity,
            detail,
          },
        };
      }
      case "drain-and-replace": {
        // Pin 1 at runtime: drain-and-replace requires a drainable policy + probe.
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
        const admission = budget.admit(lineageOf(probe), why);
        if (admission.kind === "giveUp") {
          return enactGiveUp({
            why: admission.why,
            reason: admission.reason,
            onGiveUp: budget.policy.onGiveUp,
            axis: decision.axis,
            running: probe.identity,
            bind,
            log: endpoint.log,
            skewCtx,
          });
        }
        endpoint.log.info(
          { axis: decision.axis, attempt: admission.attempt, ...skewCtx },
          "convergence: draining a superseded survivor (persist + exit; its children survive) and respawning our own build",
        );
        // Framework-run drain — same skeleton as convergeAdmit. Ground truth is
        // exit observation, never the drain call's resolve/reject.
        const drain = await drainAndAwaitExit(
          () => probe.fireDrain(),
          (signal) => probe.awaitExit(signal),
          { ceilingMs: probe.drainCeilingMs },
        );
        if (!drain.took) {
          const notTaken =
            `${why}: drain did not take within ${probe.drainCeilingMs}ms — the daemon kept answering` +
            drainRejectionSuffix(drain.drainRejection);
          endpoint.log.error(
            { axis: decision.axis, ...skewCtx },
            `convergence: drain FAILED — ${notTaken}`,
          );
          return enactGiveUp({
            why: "budget",
            reason: notTaken,
            onGiveUp: budget.policy.onGiveUp,
            axis: decision.axis,
            running: probe.identity,
            bind,
            log: endpoint.log,
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
        // No supervisor action on the BUILD — the caller surfaces the mismatch (the
        // currency nudge). The bind still runs to ADOPT the compatible survivor.
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

/** Endpoint-arm give-up: shared anomaly table, then bind so the endpoint settles. */
async function enactGiveUp(args: {
  why: "cross-supervisor" | "budget";
  reason: string;
  onGiveUp: "refuse" | "adopt-stale";
  axis: "contract" | "build";
  running: ConvergenceIdentity;
  bind: () => Promise<boolean>;
  log: Logger;
  skewCtx: Record<string, string>;
}): Promise<ConvergenceOutcome> {
  const g = giveUpOutcome({
    why: args.why,
    reason: args.reason,
    onGiveUp: args.onGiveUp,
    axis: args.axis,
    running: args.running,
    log: args.log,
    skewCtx: args.skewCtx,
    logPrefix: "convergence",
  });
  const adopted = await args.bind();
  if (g.kind === "adopt-stale") {
    return {
      kind: adopted ? "adopted" : "not-adopted",
      anomaly: g.anomaly,
    };
  }
  return { kind: "refused", adopted, anomaly: g.anomaly };
}
