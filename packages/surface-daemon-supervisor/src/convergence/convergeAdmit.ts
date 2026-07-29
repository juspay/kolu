/**
 * `convergeAdmit` — the connector-arm enactment of the kit (ssh / any transport that
 * has already dialed a running daemon). Same decision table, drain, and budget as
 * `converge(endpoint)`, without an endpoint: the consumer supplies the running
 * identity and two plugs (fire the drain verb; observe exit), and the framework owns
 * the race/ceiling/budget/cross-supervisor memory.
 *
 * **Budget must be a {@link ConnectorDrainBudget}** (F7) — recycle / nudge-human are
 * unspellable at the type level; no runtime throws for wrong policy arms.
 *
 * **`awaitExit` contract (F3):** resolve ONLY when an independent process/instance
 * oracle confirms the daemon is gone (gate gone, pid reaped, ssh process exit).
 * Sustained RPC/`hello` failure is NOT exit — if the link is down and the oracle
 * cannot confirm, leave the wait hanging until the ceiling (drain-not-taken), never
 * report `replaced`.
 */

import {
  buildLabel,
  type ConvergenceIdentity,
  type Logger,
} from "@kolu/surface-daemon";
import type { ConvergenceAnomaly, RefusedAnomaly } from "./anomaly.ts";
import {
  type ConnectorDrainBudget,
  type DrainLineage,
  budgetInternal,
  drainBudgetOf,
  policyOf,
} from "./budget.ts";
import { drainAndAwaitExit } from "./drainAndAwaitExit.ts";
import { decide } from "./decide.ts";
import { giveUpOutcome } from "./giveUp.ts";
import type { InstanceKey } from "./instanceKey.ts";

/** A running daemon's identity + the instance key the budget tracks. */
export type RunningDaemon = ConvergenceIdentity & {
  /** Instance key for the drain budget — prefer {@link instanceKeyFromStartedAt}. */
  readonly instanceKey: InstanceKey;
};

/**
 * Verdict of `convergeAdmit`. Anomaly is required on kinds that can be degraded and
 * **absent** on kinds that cannot — never optional.
 */
export type ConvergeAdmitVerdict =
  | { readonly kind: "adopt" }
  | {
      readonly kind: "adopt-stale";
      readonly anomaly: Extract<ConvergenceAnomaly, { kind: "adopted-stale" }>;
    }
  | {
      readonly kind: "replaced";
      readonly reason: string;
    }
  | {
      readonly kind: "refuse";
      readonly anomaly: RefusedAnomaly;
      /** Human message for the session's refuse state. */
      readonly error: string;
    };

export async function convergeAdmit(args: {
  /** What the dial found — the running daemon's identity (+ instance key). */
  running: RunningDaemon;
  /**
   * Connector budget from {@link createConnectorDrainBudget} (F7). Typed as
   * {@link ConnectorDrainBudget} so recycle/nudge-human policies are unspellable.
   */
  budget: ConnectorDrainBudget;
  /** Fire the drain verb (the daemon's control-core `drain`). Fire-and-forget;
   *  ground truth is `awaitExit`. */
  drain: () => Promise<void>;
  /**
   * Observe that the daemon process actually left (F3). Armed before `drain`.
   * Resolve only from an independent process oracle — NOT from a single RPC
   * rejection. Honour the abort signal when the ceiling wins.
   */
  awaitExit: (signal: AbortSignal) => Promise<void>;
  /** Ceiling for the exit wait (transport-adapted: local ~2s, ssh ~6s). */
  ceilingMs: number;
  log: Logger;
}): Promise<ConvergeAdmitVerdict> {
  const { running, budget, log } = args;
  const policy = policyOf(budget);
  const baked = policy.baked;
  const identity: ConvergenceIdentity = {
    contractVersion: running.contractVersion,
    build: running.build,
  };
  const lineage: DrainLineage = {
    build: running.build,
    instanceKey: running.instanceKey,
  };

  const decision = decide(policy, identity);
  const skewCtx = {
    runningContract: identity.contractVersion,
    mineContract: baked.contractVersion,
    runningBuild: buildLabel(identity.build),
    mineBuild: buildLabel(baked.build),
  };

  // ConnectorPolicy makes recycle / report-mismatch unspellable at the type
  // level (F7) — no runtime endpoint-only throws. Cast so those arms are not
  // switch cases (decide's return type is still the full Decision union).
  type ConnectorDecision = Exclude<
    typeof decision,
    { kind: "recycle" } | { kind: "report-mismatch" }
  >;
  const d = decision as ConnectorDecision;

  switch (d.kind) {
    case "spawn":
      throw new Error(
        "convergeAdmit: decide returned spawn for a live running identity — unreachable",
      );

    case "adopt":
      return { kind: "adopt" };

    case "refuse": {
      const detail =
        `contract skew: running serves ${identity.contractVersion}, ` +
        `supervisor needs ${baked.contractVersion} — this binder is OLDER/behind, refusing`;
      log.warn(
        skewCtx,
        "convergence admit: REFUSING a skewed survivor — left standing + degraded, never touched",
      );
      return {
        kind: "refuse",
        error: detail,
        anomaly: {
          kind: "skew-refused",
          running: identity,
          expected: baked,
          detail,
        },
      };
    }

    case "drain-and-replace": {
      const why =
        d.axis === "contract"
          ? `contract skew (mine ${baked.contractVersion} newer than running ${identity.contractVersion})`
          : `build mismatch (running=${buildLabel(identity.build)} expected=${buildLabel(baked.build)})`;
      const admission = budgetInternal(budget).admit(lineage, why);
      if (admission.kind === "giveUp") {
        return toAdmitVerdict(
          giveUpOutcome({
            admission,
            onGiveUp: drainBudgetOf(budget).onGiveUp,
            axis: d.axis,
            running: identity,
            expected: baked,
            log,
            skewCtx,
            logPrefix: "convergence admit",
          }),
        );
      }
      log.info(
        { axis: d.axis, attempt: admission.attempt, ...skewCtx },
        "convergence admit: draining a superseded survivor and awaiting exit",
      );
      const drain = await drainAndAwaitExit(args.drain, args.awaitExit, {
        ceilingMs: args.ceilingMs,
      });
      if (drain.took) {
        return {
          kind: "replaced",
          reason:
            d.axis === "contract"
              ? "daemon drained (newer contract) — reconnecting to the respawned newer build"
              : "daemon drained (build mismatch) — reconnecting to re-handshake the survivor",
        };
      }
      // Drain not taken (ceiling or link-down without process oracle) — never
      // replaced (F3).
      return toAdmitVerdict(
        giveUpOutcome({
          admission: {
            kind: "giveUp",
            why: "budget",
            axisHint: why,
            attempts: admission.attempt,
            maxAttempts: drainBudgetOf(budget).maxAttempts,
            instanceKey: running.instanceKey,
          },
          onGiveUp: drainBudgetOf(budget).onGiveUp,
          axis: d.axis,
          running: identity,
          expected: baked,
          log,
          skewCtx,
          logPrefix: "convergence admit",
          drainNotTaken: {
            ceilingMs: args.ceilingMs,
            rejection: drain.drainRejection,
          },
        }),
      );
    }

    default: {
      const _exhaustive: never = d;
      throw new Error(
        `convergeAdmit: unreachable decision ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

function toAdmitVerdict(
  g: ReturnType<typeof giveUpOutcome>,
): ConvergeAdmitVerdict {
  if (g.kind === "adopt-stale") {
    return { kind: "adopt-stale", anomaly: g.anomaly };
  }
  return { kind: "refuse", error: g.error, anomaly: g.anomaly };
}
