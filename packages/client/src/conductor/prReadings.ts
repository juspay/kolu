import { activeArm } from "@kolu/padi-client/surface";
import { type PrInfo, prValue } from "anyforge/schemas";
import { Option } from "effect";
import {
  type CheckKind,
  type MergeBlock,
  type MergeState,
  isOpenDraft,
  prOf,
  type Work,
} from "kolu-work";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";

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

export function checksProgress(tally: ChecksTally): string {
  return `${tally.pass + tally.fail} of ${tally.total} checks`;
}

function checksBreakdown(tally: ChecksTally): string {
  return `${tally.pass} passed · ${tally.pending} running · ${tally.fail} failed`;
}

const BLOCK_WORDS: Record<MergeBlock, string> = {
  blocked: "the branch's rules still want something, such as a required check",
  review: "a review is required",
  behind: "the branch is behind its base",
  conflicts: "it conflicts with its base",
  draft: "it is a draft",
};

type MergeKnown = MergeState | { readonly kind: "unknown" };

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

export const mergeReason = (merge: MergeKnown): string =>
  merge.kind === "cannot" ? merge.why : merge.kind;

export interface PrSection {
  readonly number: number;
  readonly state: "open" | "merged" | "closed";
  readonly draft: boolean;
  readonly checks: string;
  readonly failing: ReadonlyArray<string>;
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

const FAILING_NAMED = 2;

export const failingLine = (names: ReadonlyArray<string>): string => {
  const rest = names.length - FAILING_NAMED;
  return `${names.length} failing: ${names.slice(0, FAILING_NAMED).join(", ")}${
    rest > 0 ? `, +${rest}` : ""
  }`;
};

export function prSection(
  work: Work,
  live: Option.Option<ChecksTally>,
): Option.Option<PrSection> {
  return Option.map(prOf(work), (pr) => {
    const last = Option.isSome(live) ? Option.none() : pr.lastCheck;
    return {
      number: pr.number,
      state: pr.state,
      draft: isOpenDraft(pr),
      checks: Option.match(live, {
        onSome: checksBreakdown,
        onNone: () =>
          Option.match(last, {
            onNone: () => "No checks reported",
            onSome: (one) => RECORDED_CHECKS[one.kind],
          }),
      }),
      failing: Option.match(last, {
        onNone: () => [],
        onSome: (one) => one.failing,
      }),
      merge:
        pr.state !== "open"
          ? Option.none()
          : Option.some({
              words: mergeWords(pr.merge),
              reason: mergeReason(pr.merge),
            }),
    };
  });
}

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
