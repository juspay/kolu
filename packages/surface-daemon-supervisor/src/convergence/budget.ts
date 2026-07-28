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
 * Deliberately NOT a once-per-boot boolean fence: a boolean spends on the first drain
 * and then forever adopts, which wipes the memory needed to notice a cross-supervisor
 * fight. Resetting on adopt is the same defect — the memory of what we drained is
 * exactly what the next dial needs.
 *
 * Instance key defaults to whatever the probe supplies (the fragment's `startedAt` for
 * padi); `null`/absent is a single anonymous lineage.
 */

import type { DaemonBuild } from "@kolu/surface-daemon";
import { buildLabel } from "@kolu/surface-daemon";
import type { DrainBudget } from "./policy.ts";

/** A running daemon's budget identity — build + instance key. */
export type DrainLineage = {
  readonly build: DaemonBuild;
  /** Instance key (fragment `startedAt`, or null when the probe has no instance). */
  readonly instanceKey: string | number | null;
};

/** Admission verdict for one drain attempt. */
export type DrainAdmission =
  | { readonly kind: "drain"; readonly attempt: number }
  | {
      readonly kind: "giveUp";
      readonly why: "cross-supervisor" | "budget";
      readonly reason: string;
    };

export interface DrainBudgetMemory {
  /** May we drain this lineage? Records the attempt on `"drain"`. */
  admit(lineage: DrainLineage, why: string): DrainAdmission;
  /** Policy data this memory was created with (for give-up mapping). */
  readonly policy: DrainBudget;
}

function lineageKey(lineage: DrainLineage): string {
  return `${buildLabel(lineage.build)}\0${String(lineage.instanceKey)}`;
}

function buildKey(build: DaemonBuild): string {
  return buildLabel(build);
}

/** A fresh, empty budget memory for one supervisor boot. Exactly one per boot;
 *  shared by every dial / admit of that boot. */
export function createDrainBudget(policy: DrainBudget): DrainBudgetMemory {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new Error(
      `drainBudget.maxAttempts must be a positive integer, got ${policy.maxAttempts}`,
    );
  }
  // Lineages we have drained (or committed to drain) this boot — by full (build, instance).
  const drainedLineages = new Set<string>();
  // Builds we have drained under ANY instance — for the cross-supervisor check.
  const drainedBuilds = new Set<string>();
  // Per-lineage attempt counts (same instance flapping).
  const attemptsByLineage = new Map<string, number>();

  return {
    policy,
    admit(lineage, why) {
      const lkey = lineageKey(lineage);
      const bkey = buildKey(lineage.build);

      // A drained *build* reappearing under a different instance → another supervisor
      // is fighting us. (Same lineage re-entering is the flap path below.)
      if (drainedBuilds.has(bkey) && !drainedLineages.has(lkey)) {
        return {
          kind: "giveUp",
          why: "cross-supervisor",
          reason:
            `${why}: a DIFFERENT instance (key ${String(lineage.instanceKey)}) of a build ` +
            `this supervisor already drained this boot is still wrong — another supervisor ` +
            `is respawning it (anti-livelock)`,
        };
      }

      const attempts = attemptsByLineage.get(lkey) ?? 0;
      if (attempts >= policy.maxAttempts) {
        return {
          kind: "giveUp",
          why: "budget",
          reason:
            `${why}: instance key ${String(lineage.instanceKey)} survived ` +
            `${attempts} drain attempts without converging — a flapping link / respawn ` +
            `loop that will not converge`,
        };
      }

      const next = attempts + 1;
      attemptsByLineage.set(lkey, next);
      drainedLineages.add(lkey);
      drainedBuilds.add(bkey);
      return { kind: "drain", attempt: next };
    },
  };
}
