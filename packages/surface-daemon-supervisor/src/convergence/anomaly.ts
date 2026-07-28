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

/** Typed cause for {@link ConvergenceAnomaly} `unconverged` — evidence as data. */
export type UnconvergedCause =
  | {
      readonly kind: "budget-exhausted";
      readonly axis: "contract" | "build";
      readonly attempts: number;
      readonly maxAttempts: number;
    }
  | {
      readonly kind: "drain-not-taken";
      readonly axis: "contract" | "build";
      readonly ceilingMs: number;
      /** Mid-write drain rejection text, if any; null when the drain call resolved. */
      readonly rejection: string | null;
    }
  | {
      readonly kind: "adopt-bind-failed";
      readonly axis: "contract" | "build" | null;
    }
  /** Bound a resident the probe could not characterize (F1b / F2). */
  | { readonly kind: "identity-unverifiable" }
  /** Probe threw (not no-listener) — loud typed failure (F2). */
  | { readonly kind: "probe-failed"; readonly message: string };

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
      /**
       * Last known running identity, or **null when honestly unknown** (e.g.
       * initial probe threw before any observation — F19 / W5 running-unknown).
       * Never fabricates `expected` as a stand-in for unknown.
       */
      readonly running: ConvergenceIdentity | null;
      readonly expected: ConvergenceIdentity;
      readonly cause: UnconvergedCause;
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

/** Anomalies that may ride a `refused` outcome — never adopted-stale. */
export type RefusedAnomaly = Exclude<
  ConvergenceAnomaly,
  { kind: "adopted-stale" }
>;
