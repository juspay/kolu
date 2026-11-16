/** WHAT A CARD SAYS ABOUT A WORK'S PULL REQUEST — its checks (the live count
 *  while a member's record carries one, else the last result the timeline
 *  kept), whether GitHub would merge it and why not, and the Pull request
 *  section those make. One thing, apart from the rest of the card's words:
 *  it moves when the forge's vocabulary does (a new merge state, a new check
 *  outcome), not when the card's layout does. */

import { activeArm } from "@kolu/padi-client/surface";
import { type PrInfo, prValue } from "anyforge/schemas";
import { Option } from "effect";
import {
  type CheckKind,
  type MergeBlock,
  type MergeState,
  prOf,
  type Work,
} from "kolu-work";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";

/** A PR's checks, counted — the one LIVE fact the column mixes into a stored
 *  record. It arrives from the member terminal's own record (the fleet index),
 *  never from the timeline: the timeline says checks are running, and how many
 *  of them have landed is only true for the instant it is read. */
export interface ChecksTally {
  readonly pass: number;
  readonly pending: number;
  readonly fail: number;
  readonly total: number;
}

export function checksTally(
  pr: Option.Option<PrInfo>,
): Option.Option<ChecksTally> {
  return Option.flatMap(pr, (one) => {
    if (one.checkRuns.length === 0) return Option.none<ChecksTally>();
    const tally = { pass: 0, pending: 0, fail: 0 };
    for (const run of one.checkRuns) tally[run.outcome] += 1;
    return Option.some({ ...tally, total: one.checkRuns.length });
  });
}

/** `14 of 23 checks` — what the standing line says while CI runs. */
export function checksProgress(tally: ChecksTally): string {
  return `${tally.pass + tally.fail} of ${tally.total} checks`;
}

/** `14 passed · 9 running · 0 failed` — the Pull request section's own line,
 *  which states every bucket including the empty ones: a zero failed is the
 *  fact a reader came for. */
function checksBreakdown(tally: ChecksTally): string {
  return `${tally.pass} passed · ${tally.pending} running · ${tally.fail} failed`;
}

/** WHY GITHUB WILL NOT MERGE A PR, said plainly. */
const BLOCK_WORDS: Record<MergeBlock, string> = {
  blocked: "the branch's rules still want something, such as a required check",
  review: "a review is required",
  behind: "the branch is behind its base",
  conflicts: "it conflicts with its base",
  draft: "it is a draft",
};

/** A merge answer, or none recorded for the PR's current commit. */
type MergeKnown = MergeState | { readonly kind: "unknown" };

/** WHETHER GITHUB WOULD MERGE IT, in one phrase — a timeline row, and the
 *  Pull request section's last line. */
export function mergeWords(merge: MergeKnown): string {
  switch (merge.kind) {
    case "can":
      return "GitHub can merge it";
    case "cannot":
      return `GitHub cannot merge it yet · ${BLOCK_WORDS[merge.why]}`;
    case "unsettled":
      return "GitHub is still working out whether it can merge it";
    case "unknown":
      return "GitHub has not said whether it can merge it";
    default:
      return merge satisfies never;
  }
}

/** THE SAME ANSWER AS ONE WORD — `can`, a reason it cannot (`review`,
 *  `behind`, …), `unsettled` or `unknown` — what a face carries as data, so
 *  nothing reading it has to parse the sentence. */
export const mergeReason = (merge: MergeKnown): string =>
  merge.kind === "cannot" ? merge.why : merge.kind;

/** THE PULL REQUEST SECTION of a card: the PR and how it stands, what its
 *  checks say, and — while it is open — whether GitHub would merge it.
 *
 *  The checks are the LIVE tally while a member's record carries one (true
 *  only for the instant it is read), and otherwise the last check event the
 *  timeline recorded, with the gates that were red: that is all a finished
 *  work still knows. */
export interface PrSection {
  readonly number: number;
  readonly state: "open" | "merged" | "closed";
  readonly checks: string;
  readonly merge: Option.Option<{
    readonly words: string;
    readonly reason: string;
  }>;
}

const RECORDED_CHECKS: Record<CheckKind, string> = {
  "checks-running": "CI running when last read",
  "checks-passed": "Checks passed",
  "checks-failed": "Checks failed",
};

export function prSection(
  work: Work,
  live: Option.Option<ChecksTally>,
): Option.Option<PrSection> {
  return Option.map(prOf(work), (pr) => ({
    number: pr.number,
    state: pr.state,
    checks: Option.match(live, {
      onSome: checksBreakdown,
      onNone: () =>
        Option.match(pr.lastCheck, {
          onNone: () => "No checks reported",
          onSome: (last) =>
            `${RECORDED_CHECKS[last.kind]}${
              last.failing.length === 0 ? "" : ` · ${last.failing.join(", ")}`
            }`,
        }),
    }),
    merge:
      pr.state !== "open"
        ? Option.none()
        : Option.some({
            words: mergeWords(pr.merge),
            reason: mergeReason(pr.merge),
          }),
  }));
}

/** THE PR, LIVE — off whichever member terminal's record carries one. The
 *  timeline says the checks are running; how many have landed is only true
 *  for the instant it is read, so it is never stored. Each member's standing
 *  is read once by the caller and handed in. */
export function livePrOf(
  members: ReadonlyArray<{
    readonly standing: FleetTerminalStanding | undefined;
  }>,
): PrInfo | null {
  for (const one of members) {
    const meta = one.standing?.kind === "here" ? one.standing.meta : undefined;
    const arm = meta === undefined ? undefined : activeArm(meta);
    const pr = arm === undefined ? null : prValue(arm.pr);
    if (pr !== null) return pr;
  }
  return null;
}
