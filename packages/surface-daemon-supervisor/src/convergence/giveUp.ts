/**
 * Shared give-up mapping for both enactments (`converge` and `convergeAdmit`).
 * One anomaly table — no dual `enactGiveUp` / `giveUpVerdict` to drift.
 *
 * Input carries the typed {@link DrainAdmission} give-up arm so cross-supervisor
 * evidence (`drained` + `observed`) is required by the type, never optional.
 */

import type { ConvergenceIdentity, Logger } from "@kolu/surface-daemon";
import type { ConvergenceAnomaly } from "./anomaly.ts";
import type { DrainAdmission } from "./budget.ts";

export type GiveUpKind =
  | {
      readonly kind: "refuse";
      readonly anomaly: ConvergenceAnomaly;
      readonly error: string;
    }
  | {
      readonly kind: "adopt-stale";
      readonly anomaly: Extract<ConvergenceAnomaly, { kind: "adopted-stale" }>;
    };

/**
 * Map a budget/cross-supervisor give-up to the typed anomaly (evidence as data).
 * - cross-supervisor → always refuse (never ride a contested build)
 * - contract axis budget → always unconverged
 * - build axis + onGiveUp refuse → unconverged
 * - build axis + onGiveUp adopt-stale → adopt-stale (running + expected identities)
 */
export function giveUpOutcome(args: {
  admission: Extract<DrainAdmission, { kind: "giveUp" }>;
  onGiveUp: "refuse" | "adopt-stale";
  axis: "contract" | "build";
  running: ConvergenceIdentity;
  expected: ConvergenceIdentity;
  log: Logger;
  skewCtx: Record<string, string>;
  logPrefix: string;
}): GiveUpKind {
  if (args.admission.why === "cross-supervisor") {
    const detail = args.admission.reason;
    args.log.error(
      args.skewCtx,
      `${args.logPrefix}: CROSS-SUPERVISOR — ${detail}`,
    );
    return {
      kind: "refuse",
      error: detail,
      anomaly: {
        kind: "cross-supervisor",
        drained: args.admission.drained,
        observed: args.admission.observed,
        running: args.running,
        detail,
      },
    };
  }

  if (args.axis === "contract" || args.onGiveUp === "refuse") {
    const detail = args.admission.reason;
    args.log.error(args.skewCtx, `${args.logPrefix}: UNCONVERGED — ${detail}`);
    return {
      kind: "refuse",
      error: detail,
      anomaly: {
        kind: "unconverged",
        running: args.running,
        detail,
      },
    };
  }

  const detail = `${args.admission.reason} — riding the resident daemon; upgrade the winner or stop the respawner to converge`;
  args.log.warn(args.skewCtx, `${args.logPrefix}: ADOPTED STALE — ${detail}`);
  return {
    kind: "adopt-stale",
    anomaly: {
      kind: "adopted-stale",
      running: args.running,
      expected: args.expected,
      detail,
    },
  };
}
