/**
 * Drain budget memory — the anti-livelock state that lives inside the supervisor for
 * one boot and **survives adopts**.
 *
 * Two facts it tracks:
 *   1. How many times the SAME (build, instance) lineage has been drained this boot —
 *      bounded by `maxAttempts`. A SAME-instance flap that never exits gives up with
 *      the policy's `onGiveUp` (`adopt-stale` | `refuse`).
 *   2. Every (build, instance) lineage this supervisor has drained. A drained *build*
 *      reappearing under a **different** instance means another supervisor is
 *      respawning it → `cross-supervisor` give-up (not a fresh budget, not adopt).
 *
 * Instance keys are {@link InstanceKey}: named instances or `pre-instance` (absent
 * startedAt = older daemon, never an overloaded null).
 */

import type { DaemonBuild } from "@kolu/surface-daemon";
import type {
  ConnectorPolicy,
  ConvergencePolicy,
  DrainBudget,
} from "./policy.ts";
import { type InstanceKey, instanceKeyTag } from "./instanceKey.ts";

/** A running daemon's budget identity — build + instance key. */
export type DrainLineage = {
  readonly build: DaemonBuild;
  readonly instanceKey: InstanceKey;
};

/** Admission verdict for one drain attempt. */
export type DrainAdmission =
  | { readonly kind: "drain"; readonly attempt: number }
  | {
      readonly kind: "giveUp";
      readonly why: "budget";
      readonly reason: string;
    }
  | {
      readonly kind: "giveUp";
      readonly why: "cross-supervisor";
      /** Instance this supervisor previously drained for this build. */
      readonly drained: InstanceKey;
      /** Instance key of the daemon currently observed. */
      readonly observed: InstanceKey;
      readonly reason: string;
    };

export interface DrainBudgetMemory {
  /** May we drain this lineage? Records the attempt on `"drain"`. */
  admit(lineage: DrainLineage, why: string): DrainAdmission;
  /**
   * The whole policy this memory was created from. Endpoint arms may pass any
   * drainable policy; connector arms should pass {@link ConnectorPolicy}.
   */
  readonly policy: ConvergencePolicy<"drainable"> | ConnectorPolicy;
  readonly drainBudget: DrainBudget;
}

function lineageKey(lineage: DrainLineage): string {
  return `${buildKey(lineage.build)}\0${instanceKeyTag(lineage.instanceKey)}`;
}

function buildKey(build: DaemonBuild): string {
  switch (build.kind) {
    case "known":
      return `known:${build.id}`;
    case "off-nix":
      return "off-nix";
    default: {
      const _exhaustive: never = build;
      throw new Error(
        `unreachable DaemonBuild: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * For a drained *build*, remember one drained instance key so a foreign reappearance
 * can report both keys as data on the cross-supervisor anomaly.
 */
export function createDrainBudget(
  policy: ConvergencePolicy<"drainable"> | ConnectorPolicy,
): DrainBudgetMemory {
  const drainBudget = policy.drainBudget;
  if (
    !Number.isInteger(drainBudget.maxAttempts) ||
    drainBudget.maxAttempts < 1
  ) {
    throw new Error(
      `drainBudget.maxAttempts must be a positive integer, got ${drainBudget.maxAttempts}`,
    );
  }
  const drainedLineages = new Set<string>();
  /** buildKey → last drained InstanceKey for that build. */
  const drainedInstanceByBuild = new Map<string, InstanceKey>();
  const attemptsByLineage = new Map<string, number>();

  return {
    policy,
    drainBudget,
    admit(lineage, why) {
      const lkey = lineageKey(lineage);
      const bkey = buildKey(lineage.build);

      const priorDrained = drainedInstanceByBuild.get(bkey);
      if (priorDrained !== undefined && !drainedLineages.has(lkey)) {
        return {
          kind: "giveUp",
          why: "cross-supervisor",
          drained: priorDrained,
          observed: lineage.instanceKey,
          reason:
            `${why}: a DIFFERENT instance of a build this supervisor already drained ` +
            `this boot is still wrong — another supervisor is respawning it (anti-livelock; ` +
            `multi-supervisor-per-host is not a supported topology)`,
        };
      }

      const attempts = attemptsByLineage.get(lkey) ?? 0;
      if (attempts >= drainBudget.maxAttempts) {
        return {
          kind: "giveUp",
          why: "budget",
          reason:
            `${why}: lineage ${instanceKeyTag(lineage.instanceKey)} survived ` +
            `${attempts} drain attempts without converging — a flapping link / respawn ` +
            `loop that will not converge`,
        };
      }

      // pre-instance: absent startedAt means older — still budgetable as one lineage,
      // but never collides with a named instance under the same build (different lkey).
      const next = attempts + 1;
      attemptsByLineage.set(lkey, next);
      drainedLineages.add(lkey);
      drainedInstanceByBuild.set(bkey, lineage.instanceKey);
      return { kind: "drain", attempt: next };
    },
  };
}
