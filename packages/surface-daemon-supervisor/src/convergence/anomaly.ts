/**
 * {@link ConvergenceAnomaly} — the framework's standing convergence-state union.
 *
 * Four arms, each with evidence. Absence of an anomaly = converged clean.
 * `link-failed` is deliberately NOT here: "the wire died" is the session's fact,
 * not a convergence verdict — no convergence code path can produce it, and it clears
 * on different rules. Apps union it in themselves at the edge.
 *
 * `cross-supervisor` MUST be in the framework union: the admission machinery is what
 * detects it, and its absence is why consumers grew sidecar-flag hacks.
 */

import type { ConvergenceIdentity } from "@kolu/surface-daemon";

export type ConvergenceAnomaly =
  | {
      readonly kind: "adopted-stale";
      readonly running: ConvergenceIdentity;
      readonly detail: string;
    }
  | {
      readonly kind: "skew-refused";
      readonly running: ConvergenceIdentity;
      readonly detail: string;
    }
  | {
      readonly kind: "unconverged";
      readonly running: ConvergenceIdentity | null;
      readonly detail: string;
    }
  | {
      readonly kind: "cross-supervisor";
      readonly running: ConvergenceIdentity | null;
      readonly detail: string;
    };
