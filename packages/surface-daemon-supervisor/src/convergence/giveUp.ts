/**
 * Shared give-up mapping for both enactments (`converge` and `convergeAdmit`).
 * One anomaly table — no dual `enactGiveUp` / `giveUpVerdict` to drift.
 */

import {
  buildLabel,
  type ConvergenceIdentity,
  type Logger,
} from "@kolu/surface-daemon";
import type { ConvergenceAnomaly, UnconvergedCause } from "./anomaly.ts";
import type { DrainAdmission } from "./budget.ts";
import { instanceKeyTag } from "./instanceKey.ts";

export type GiveUpKind =
  | {
      readonly kind: "refuse";
      readonly anomaly: Exclude<ConvergenceAnomaly, { kind: "adopted-stale" }>;
      readonly error: string;
    }
  | {
      readonly kind: "adopt-stale";
      readonly anomaly: Extract<ConvergenceAnomaly, { kind: "adopted-stale" }>;
    };

function unconvergedDetail(
  running: ConvergenceIdentity,
  expected: ConvergenceIdentity,
  cause: UnconvergedCause,
): string {
  switch (cause.kind) {
    case "budget-exhausted":
      return (
        `${cause.axis}: lineage survived ${cause.attempts}/${cause.maxAttempts} ` +
        `drain attempts without converging — a flapping link / respawn loop that will not converge`
      );
    case "drain-not-taken":
      return (
        `${cause.axis}: drain did not take within ${cause.ceilingMs}ms — the daemon kept answering` +
        (cause.rejection ? `; drain call rejected: ${cause.rejection}` : "")
      );
    case "adopt-bind-failed":
      return `bind refused or failed after give-up (running=${buildLabel(running.build)} expected=${buildLabel(expected.build)})`;
    default: {
      const _e: never = cause;
      throw new Error(`unreachable UnconvergedCause: ${JSON.stringify(_e)}`);
    }
  }
}

/**
 * Map a budget/cross-supervisor give-up to the typed anomaly (evidence as data).
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
  /** When give-up is drain-not-taken rather than budget admit. */
  drainNotTaken?: {
    ceilingMs: number;
    rejection: string | null;
  };
}): GiveUpKind {
  if (args.admission.why === "cross-supervisor") {
    const detail =
      `${args.admission.axisHint}: a DIFFERENT instance of a build this supervisor already drained ` +
      `this boot is still wrong — another supervisor is respawning it (anti-livelock; ` +
      `multi-supervisor-per-host is not a supported topology) ` +
      `(drained=${instanceKeyTag(args.admission.drained)} observed=${instanceKeyTag(args.admission.observed)})`;
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

  // budget path — may be drain-not-taken overlay
  const cause: UnconvergedCause = args.drainNotTaken
    ? {
        kind: "drain-not-taken",
        axis: args.axis,
        ceilingMs: args.drainNotTaken.ceilingMs,
        rejection: args.drainNotTaken.rejection,
      }
    : {
        kind: "budget-exhausted",
        axis: args.axis,
        attempts: args.admission.attempts,
        maxAttempts: args.admission.maxAttempts,
      };

  if (args.axis === "contract" || args.onGiveUp === "refuse") {
    const detail = unconvergedDetail(args.running, args.expected, cause);
    args.log.error(args.skewCtx, `${args.logPrefix}: UNCONVERGED — ${detail}`);
    return {
      kind: "refuse",
      error: detail,
      anomaly: {
        kind: "unconverged",
        running: args.running,
        expected: args.expected,
        cause,
        detail,
      },
    };
  }

  const detail =
    unconvergedDetail(args.running, args.expected, cause) +
    " — riding the resident daemon; upgrade the winner or stop the respawner to converge";
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
