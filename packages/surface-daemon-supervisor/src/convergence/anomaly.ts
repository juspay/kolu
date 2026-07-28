/**
 * {@link ConvergenceAnomaly} — the framework's standing convergence-state union.
 *
 * Four arms, each with **typed evidence as data** (`detail` is human garnish only —
 * a UI must never parse a sentence). Absence of an anomaly = converged clean.
 *
 * `link-failed` is deliberately NOT here: "the wire died" is the session's fact,
 * not a convergence verdict. Apps union it in themselves at the edge.
 *
 * `cross-supervisor` MUST be in the framework union: the admission machinery is
 * what detects it (and multi-supervisor-per-host is not a supported topology —
 * the arm is a loud refusal naming the conflict).
 */

import type { ConvergenceIdentity } from "@kolu/surface-daemon";
import type { InstanceKey } from "./instanceKey.ts";

export type ConvergenceAnomaly =
  | {
      readonly kind: "adopted-stale";
      /** The resident daemon's identity (what we are riding). */
      readonly running: ConvergenceIdentity;
      /** The supervisor's baked identity (what we wanted). */
      readonly expected: ConvergenceIdentity;
      readonly detail: string;
    }
  | {
      readonly kind: "skew-refused";
      readonly running: ConvergenceIdentity;
      readonly expected: ConvergenceIdentity;
      readonly detail: string;
    }
  | {
      readonly kind: "unconverged";
      readonly running: ConvergenceIdentity;
      readonly detail: string;
    }
  | {
      readonly kind: "cross-supervisor";
      /** Lineage instance this supervisor drained this boot. */
      readonly drained: InstanceKey;
      /** Instance key of the daemon that reappeared under a foreign lineage. */
      readonly observed: InstanceKey;
      readonly running: ConvergenceIdentity;
      readonly detail: string;
    };
