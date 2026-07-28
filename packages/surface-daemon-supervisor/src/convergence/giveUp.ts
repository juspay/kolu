/**
 * Shared give-up mapping for both enactments (`converge` and `convergeAdmit`).
 * One anomaly table — no dual `enactGiveUp` / `giveUpVerdict` to drift.
 */

import type { ConvergenceIdentity, Logger } from "@kolu/surface-daemon";
import type { ConvergenceAnomaly } from "./anomaly.ts";

export type GiveUpKind =
  | {
      readonly kind: "refuse";
      readonly anomaly: ConvergenceAnomaly;
      readonly error: string;
    }
  | {
      readonly kind: "adopt-stale";
      readonly anomaly: ConvergenceAnomaly;
    };

/**
 * Map a budget/cross-supervisor give-up to the typed anomaly.
 * - cross-supervisor → always refuse (never ride a contested build)
 * - contract axis budget → always unconverged (incompatible wire can't be a canvas)
 * - build axis + onGiveUp refuse → unconverged
 * - build axis + onGiveUp adopt-stale → adopt-stale
 */
export function giveUpOutcome(args: {
  why: "cross-supervisor" | "budget";
  reason: string;
  onGiveUp: "refuse" | "adopt-stale";
  axis: "contract" | "build";
  running: ConvergenceIdentity;
  log: Logger;
  skewCtx: Record<string, string>;
  /** Log line prefix — "convergence" vs "convergence admit". */
  logPrefix: string;
}): GiveUpKind {
  if (args.why === "cross-supervisor") {
    const detail = args.reason;
    args.log.error(
      args.skewCtx,
      `${args.logPrefix}: CROSS-SUPERVISOR — ${detail}`,
    );
    return {
      kind: "refuse",
      error: detail,
      anomaly: {
        kind: "cross-supervisor",
        running: args.running,
        detail,
      },
    };
  }

  if (args.axis === "contract" || args.onGiveUp === "refuse") {
    const detail = args.reason;
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

  const detail = `${args.reason} — riding the resident daemon; upgrade the winner or stop the respawner to converge`;
  args.log.warn(args.skewCtx, `${args.logPrefix}: ADOPTED STALE — ${detail}`);
  return {
    kind: "adopt-stale",
    anomaly: {
      kind: "adopted-stale",
      running: args.running,
      detail,
    },
  };
}
