/**
 * A CLASSIFIED failure ledger — a bounded retry budget whose classes cannot
 * count each other's failures.
 *
 * ## The disease this makes unrepresentable
 *
 * **A bounded budget whose increment predicate differs from its ceiling
 * predicate.** One counter is bumped for every failure of any kind, while the
 * give-up gate reads it only under a narrower predicate:
 *
 * ```ts
 * consecutiveFailures += 1;                              // EVERY cause
 * if (cause === "remote" && consecutiveFailures >= 5) …   // ONE cause
 * ```
 *
 * Every failure of the unbounded class silently spends the bounded class's
 * budget. The code reads as if it counts "five consecutive remote rejections";
 * it actually counts "any five failures, the last of which was remote". No
 * single-cause test can see the gap — an all-network run never evaluates the
 * `cause === "remote"` arm however high the counter climbs, and an all-remote
 * run has nothing inflating it unfairly. Only INTERLEAVING exposes it.
 *
 * ## The incident (juspay/kolu#2101)
 *
 * A laptop slept overnight with a remote host session pinned. ~18 straight
 * `host unreachable` failures (the unbounded, retry-forever class) walked the
 * shared counter to 18. At a dark-wake the host accepted the connection and
 * then dozed mid-handshake — ONE failure of the bounded class. It landed on a
 * counter already ≥ 18 and went instantly terminal, with a card that read
 * "gave up after 5 consecutive failures". It was one. The user had to
 * reconnect by hand a host that was merely asleep.
 *
 * ## The shape of the cure
 *
 * Each class owns its OWN run. A verdict for a class is computed from that
 * class's run and that class's ceiling — there is no shared counter in the
 * verdict path to misread, so the increment predicate and the ceiling
 * predicate are the SAME predicate by construction. Callers receive
 * {@link FailureVerdict}s, never raw counts, so a give-up message built from
 * `verdict.run` can only ever name the run that actually tripped the ceiling:
 * truth by construction rather than truth by review.
 *
 * Interleaving between classes is DATA, not control flow: a class declares
 * which other classes' runs a recording of it resets, in its spec, beside the
 * rationale for the rule. `@kolu/surface-remote`'s session declares that a
 * network failure resets the remote run — an unreachable gap means the host
 * WENT AWAY, so the next remote blip is fresh evidence of a sleeping host, not
 * accumulation of a persisting fault.
 *
 * ## Why this lives in the framework
 *
 * This is a LEAF PRIMITIVE, not a volatility receptacle: it hides a bounded
 * algorithm (counting), owns no transport, no clock, and no I/O, and its
 * dependency arrow points nowhere. It sits in `@kolu/surface` so that every
 * consumer with a classified retry inherits the impossibility instead of
 * re-deriving the counter — and so the anti-conflation LAW is pinned once here
 * in the framework rather than once per consumer.
 *
 * A SINGLE-class budget does not need this (its one increment and its one
 * ceiling already share the one predicate — the disease is unspellable);
 * `@kolu/surface-remote`'s `makeStepBudget` is the ratified example of that
 * shape staying hand-rolled.
 */

/** How ONE failure class is budgeted. */
export interface FailureClassSpec {
  /** The run length at which this class's own verdict reports `exhausted`.
   *  `null` = UNBOUNDED: this class can NEVER produce an exhausted verdict, at
   *  any run length (the retry-forever class — a roaming laptop's unreachable
   *  host). */
  readonly ceiling: number | null;
  /** Classes whose run a recording of THIS class resets — the interleaving
   *  rule, stated as data so it is inspectable rather than buried in a branch.
   *  Every name must be a key of the same spec (validated at construction).
   *  Write the rationale for the rule as a comment beside it in the spec
   *  literal: the rule is a domain claim, and the ledger cannot check it. */
  readonly resets?: readonly string[];
}

/** What a recording says about the class that was recorded — and ONLY about
 *  that class. There is no field here that any other class's activity can
 *  move. */
export interface FailureVerdict {
  /** True iff THIS class's own run reached THIS class's own ceiling. Computed
   *  from `run` and `ceiling` below and nothing else — an unbounded class is
   *  always `false`. */
  readonly exhausted: boolean;
  /** This class's run length AFTER the recording. Safe to print in a give-up
   *  message: it can only ever name the true same-class run. */
  readonly run: number;
  /** The ceiling this run was judged against (`null` = unbounded). */
  readonly ceiling: number | null;
}

/** A per-class failure budget. Built by {@link makeFailureLedger}. */
export interface FailureLedger<K extends string> {
  /** Record one failure of class `cause` and judge it. Applies `cause`'s
   *  declared `resets` first, then extends `cause`'s own run. */
  record(cause: K): FailureVerdict;
  /** A success clears every class's run AND the attempt count — the whole
   *  ledger goes back to birth. */
  success(): void;
  /** DISPLAY / BACKOFF-PACING ONLY: total recordings since the last
   *  {@link success}, across all classes (declared `resets` do not clear it —
   *  a reset restores a class's BUDGET, not the pace of retrying).
   *
   *  Deliberately exposed for backoff exponents and "attempt N" log lines, and
   *  deliberately NOT consulted by any ceiling: no verdict reads this number.
   *  That split is the whole point — the conflated counter this module retires
   *  was exactly a pacing number wired into a gate. */
  attempts(): number;
}

/**
 * Build a {@link FailureLedger} from a per-class spec.
 *
 * Fails fast at CONSTRUCTION on a `resets` entry naming a class the spec does
 * not declare — a typo there would silently disable an interleaving rule the
 * consumer is relying on, which is precisely the class of silence this module
 * exists to end.
 */
export function makeFailureLedger<K extends string>(
  spec: Record<K, FailureClassSpec>,
): FailureLedger<K> {
  const classes = Object.keys(spec) as K[];
  for (const name of classes) {
    for (const target of spec[name].resets ?? []) {
      if (!Object.hasOwn(spec, target)) {
        throw new Error(
          `failure ledger: class "${name}" declares resets:["${target}"], but "${target}" is not a class in this spec (have: ${classes.join(", ")})`,
        );
      }
    }
  }

  const runs = new Map<K, number>(classes.map((name) => [name, 0]));
  let attempts = 0;

  return {
    record(cause: K): FailureVerdict {
      const classSpec = spec[cause];
      if (classSpec === undefined) {
        throw new Error(
          `failure ledger: recorded unknown failure class "${cause}" (have: ${classes.join(", ")})`,
        );
      }
      attempts += 1;
      // Resets land BEFORE this class's own increment, so a class that names
      // itself in `resets` (a "never accumulates" class) reports run=1 forever
      // rather than the contradictory 0.
      for (const target of classSpec.resets ?? []) {
        runs.set(target as K, 0);
      }
      const run = (runs.get(cause) ?? 0) + 1;
      runs.set(cause, run);
      const ceiling = classSpec.ceiling;
      // THE anti-conflation line: `exhausted` reads this class's run and this
      // class's ceiling. No other class's state is in scope of this expression.
      return { exhausted: ceiling !== null && run >= ceiling, run, ceiling };
    },
    success(): void {
      for (const name of classes) runs.set(name, 0);
      attempts = 0;
    },
    attempts: () => attempts,
  };
}
