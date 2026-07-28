/**
 * `convergeAdmit` — the connector-arm enactment of the kit (ssh / any transport that
 * has already dialed a running daemon). Same decision table, drain, and budget as
 * `converge(endpoint)`, without an endpoint: the consumer supplies the running
 * identity and two plugs (fire the drain verb; observe exit), and the framework owns
 * the race/ceiling/budget/cross-supervisor memory.
 *
 * Verdict kinds either **always** carry their anomaly or **never** do — no optionals.
 * `link-failed` is never produced here (session-owned).
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
      readonly anomaly: ConvergenceAnomaly;
      /** Human message for the session's refuse state. */
      readonly error: string;
    };

export async function convergeAdmit(args: {
  /** What the dial found — the running daemon's identity (+ instance key). */
  running: RunningDaemon;
  /** Per-boot budget memory — owns the whole policy (created via
   *  `createDrainBudget(policy)`). Shared across every admit of this boot;
   *  survives adopts. There is no separate policy arg so the two cannot diverge. */
  budget: DrainBudgetMemory;
  /** Fire the drain verb (the daemon's control-core `drain`). Fire-and-forget;
   *  ground truth is `awaitExit`. */
  drain: () => Promise<void>;
  /** Observe that the daemon actually left. Armed before `drain`; must honour
   *  the abort signal so a not-taken drain never leaks a poll. */
  awaitExit: (signal: AbortSignal) => Promise<void>;
  /** Ceiling for the exit wait (transport-adapted: local ~2s, ssh ~6s). */
  ceilingMs: number;
  log: Logger;
}): Promise<ConvergeAdmitVerdict> {
  const { running, budget, log } = args;
  const policy = budget.policy;
  const baked = policy.baked;
  const identity: ConvergenceIdentity = {
    contractVersion: running.contractVersion,
    build: running.build,
  };
  const lineage: DrainLineage = {
    build: running.build,
    instanceKey: running.instanceKey,
  };

  const decision = decide(baked, identity, policy);
  const skewCtx = {
    runningContract: identity.contractVersion,
    mineContract: baked.contractVersion,
    runningBuild: buildLabel(identity.build),
    mineBuild: buildLabel(baked.build),
  };

  switch (decision.kind) {
    case "spawn":
      // A connector only admits a LIVE running daemon — spawn is unreachable.
      throw new Error(
        "convergeAdmit: decide returned spawn for a live running identity — unreachable",
      );

    case "adopt":
      return { kind: "adopt" };

    case "report-mismatch":
      // nudge-human is endpoint-only (mismatch-reported has no connector surface).
      // ConnectorPolicy makes this unspellable; fail loud if a budget is mis-minted.
      throw new Error(
        "convergeAdmit: onBuildMismatch: nudge-human is endpoint-only — use drain-and-replace on the connector policy",
      );

    case "recycle":
      // recycle-on-skew is endpoint-only (kill). Unspellable for a connector
      // drainable policy that should use refuse / drain-newer-else-refuse.
      throw new Error(
        "convergeAdmit: onContractSkew: recycle is endpoint-only — use refuse or drain-newer-else-refuse on the connector policy",
      );

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
        decision.axis === "contract"
          ? `contract skew (mine ${baked.contractVersion} newer than running ${identity.contractVersion})`
          : `build mismatch (running=${buildLabel(identity.build)} expected=${buildLabel(baked.build)})`;
      const admission = budget.admit(lineage, why);
      if (admission.kind === "giveUp") {
        return toAdmitVerdict(
          giveUpOutcome({
            admission,
            onGiveUp: budget.drainBudget.onGiveUp,
            axis: decision.axis,
            running: identity,
            expected: baked,
            log,
            skewCtx,
            logPrefix: "convergence admit",
          }),
        );
      }
      log.info(
        { axis: decision.axis, attempt: admission.attempt, ...skewCtx },
        "convergence admit: draining a superseded survivor and awaiting exit",
      );
      const drain = await drainAndAwaitExit(args.drain, args.awaitExit, {
        ceilingMs: args.ceilingMs,
      });
      if (drain.took) {
        return {
          kind: "replaced",
          reason:
            decision.axis === "contract"
              ? "daemon drained (newer contract) — reconnecting to the respawned newer build"
              : "daemon drained (build mismatch) — reconnecting to re-handshake the survivor",
        };
      }
      // Drain did not take — same give-up path as budget exhaustion / endpoint arm.
      const notTaken =
        `${why}: drain did not take within ${args.ceilingMs}ms — the daemon kept answering` +
        drainRejectionSuffix(drain.drainRejection);
      return toAdmitVerdict(
        giveUpOutcome({
          admission: { kind: "giveUp", why: "budget", reason: notTaken },
          onGiveUp: budget.drainBudget.onGiveUp,
          axis: decision.axis,
          running: identity,
          expected: baked,
          log,
          skewCtx,
          logPrefix: "convergence admit",
        }),
      );
    }

    default: {
      const _exhaustive: never = decision;
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
