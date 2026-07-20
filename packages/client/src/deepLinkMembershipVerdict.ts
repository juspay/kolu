/** The gone-verdict decision for a terminal deep link, extracted as a pure,
 *  side-effect-free seam so its truth table is unit-testable without mounting the
 *  router's module-singleton world (`useTerminalStore`, `activeHost`, the
 *  daemon-status subscription) — the same pure-module discipline
 *  `reattachAnnounce`/`daemonPresentation` use. The settle effect feeds it four
 *  facts about the active host's terminal membership and acts on the verdict:
 *  `wait` keeps the route armed (the backstop bounds it), `list-error` and `gone`
 *  disarm + toast, `present` proceeds to enact.
 *
 *  #1900 (secondary) — the reattach-window false gone-verdict — turns on ONE of
 *  these inputs:
 *  `converged`. A first SETTLED snapshot (`listSub.pending()` false) means "the
 *  list stream delivered a frame", NOT "membership has converged": right after a
 *  server deploy the first frame can precede kaval-survivor reattachment, so the
 *  routed terminal is momentarily absent. Verdicting `gone` on that frame is the
 *  lying toast. `converged` is the honest reattach fact (the active host's kaval
 *  reporting `connected`) that tells "not yet" apart from "gone". */

/** What the settle effect should do with the current membership facts. */
export type MembershipVerdict =
  | { readonly kind: "wait" }
  | { readonly kind: "list-error"; readonly message: string }
  | { readonly kind: "gone" }
  | { readonly kind: "present" };

/** The facts the effect reads each run. `settled` is `!listSub.pending()`;
 *  `listError` is the stream's error message (null when healthy); `converged` is
 *  the honest reattach marker (the route host's kaval `connected`); `inList` is
 *  whether the routed id is in the settled snapshot. */
export interface MembershipFacts {
  readonly settled: boolean;
  readonly listError: string | null;
  readonly converged: boolean;
  readonly inList: boolean;
}

/** Decide the verdict from the membership facts.
 *
 *  Precedence: an unsettled list waits; a faulted stream surfaces its error (we
 *  can't honestly say present or gone over a broken subscription); a present id
 *  enacts. Only when the list has SETTLED, is healthy, and the id is ABSENT do we
 *  reach the #1900 fork — and here the current shape verdicts `gone` off the first
 *  settled frame alone, IGNORING `converged`. That is the reproduced defect: a
 *  not-yet-reattached survivor reads as gone. The fix consults `converged`. */
export function membershipVerdict(facts: MembershipFacts): MembershipVerdict {
  if (!facts.settled) return { kind: "wait" };
  if (facts.listError !== null)
    return { kind: "list-error", message: facts.listError };
  if (facts.inList) return { kind: "present" };
  // Settled, healthy, id absent. #1900 RED: the gone-verdict fires WITHOUT
  // consulting `converged`, so a settled-but-not-yet-converged snapshot (the
  // post-deploy reattach window) lies "gone". The convergence gate lands in the
  // fix; until then this seam reproduces the defect for the RED pin.
  return { kind: "gone" };
}
