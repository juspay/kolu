import { foldCheckOutcomes } from "anyforge";
import {
  type CheckRun,
  type CheckStatus,
  MergeStateStatusSchema,
  type PrInfo,
  type PrResult,
  PrStateSchema,
  ReviewDecisionSchema,
} from "anyforge/schemas";
import { Schema } from "effect";
import { match, P } from "ts-pattern";
import {
  GH_PROVIDER,
  type GhUnavailableCode,
  type GhUnavailableSource,
} from "./schemas.ts";

/** Single rollup entry as `gh pr view --json statusCheckRollup` returns
 *  it. CheckRuns carry `name`; StatusContexts carry `context`. */
type RollupEntry = {
  __typename?: string;
  status?: string;
  conclusion?: string;
  state?: string;
  name?: string;
  context?: string;
};

function classifyCheck(check: RollupEntry): CheckStatus {
  if (check.__typename === "StatusContext") {
    return match(check.state?.toUpperCase())
      .with(P.union("FAILURE", "ERROR"), () => "fail" as const)
      .with(P.union("PENDING", "EXPECTED"), () => "pending" as const)
      .otherwise(() => "pass" as const);
  }
  if (check.status?.toUpperCase() !== "COMPLETED") return "pending";
  return match(check.conclusion?.toUpperCase())
    .with(
      P.union(
        "FAILURE",
        "CANCELLED",
        "TIMED_OUT",
        "STARTUP_FAILURE",
        "ACTION_REQUIRED",
        "STALE",
      ),
      () => "fail" as const,
    )
    .otherwise(() => "pass" as const);
}

export function classifyRollup(
  rollup: RollupEntry[] | undefined,
): PrInfo["checks"] {
  return foldCheckOutcomes(rollup?.map(classifyCheck) ?? []);
}

function rollupEntryName(entry: RollupEntry): string {
  return entry.__typename === "StatusContext"
    ? (entry.context ?? "?")
    : (entry.name ?? entry.context ?? "?");
}

/** Per-check breakdown of the rollup; `[]` when gh reports no checks. */
export function extractChecks(rollup: RollupEntry[] | undefined): CheckRun[] {
  if (!rollup) return [];
  return rollup.map((c) => ({
    name: rollupEntryName(c),
    outcome: classifyCheck(c),
  }));
}

export type GhPrViewJson = {
  number: number;
  title: string;
  url: string;
  state: string;
  statusCheckRollup?: RollupEntry[];
  /** gh's Go field is `ReviewDecision string` — GraphQL null serializes
   *  as `""`, never as JSON `null`. */
  reviewDecision: string;
  mergeStateStatus: string;
  headRefOid?: string;
  /** GitHub retired `mergeStateStatus: DRAFT` in 2021: a draft with green
   *  checks now answers `CLEAN`, so draft state comes from here. */
  isDraft: boolean;
};

export const GH_PR_VIEW_JSON_FIELD_LIST = Object.keys({
  number: true,
  title: true,
  url: true,
  state: true,
  statusCheckRollup: true,
  reviewDecision: true,
  mergeStateStatus: true,
  headRefOid: true,
  isDraft: true,
} satisfies Record<keyof GhPrViewJson, true>);

export const GH_PR_VIEW_JSON_FIELDS = GH_PR_VIEW_JSON_FIELD_LIST.join(",");

const decodePrState = Schema.decodeUnknownSync(PrStateSchema);
const decodeReviewDecision = Schema.decodeUnknownSync(
  Schema.NullOr(ReviewDecisionSchema),
);
const decodeMergeStateStatus = Schema.decodeUnknownSync(MergeStateStatusSchema);
const decodeIsDraft = Schema.decodeUnknownSync(Schema.Boolean);

export function prInfoFromGhView(data: GhPrViewJson): PrInfo {
  return {
    number: data.number,
    title: data.title,
    url: data.url,
    state: decodePrState(data.state.toLowerCase()),
    checks: classifyRollup(data.statusCheckRollup),
    checkRuns: extractChecks(data.statusCheckRollup),
    reviewDecision: decodeReviewDecision(
      data.reviewDecision === "" ? null : data.reviewDecision,
    ),
    mergeStateStatus: decodeMergeStateStatus(data.mergeStateStatus),
    headSha: data.headRefOid ?? null,
    isDraft: decodeIsDraft(data.isDraft),
  };
}

/** Classify a `gh pr view` failure: only a positive match on gh's "no pull
 *  requests found" stderr counts as absent; anything else unrecognized is
 *  unavailable rather than silently shown as "no PR".
 *
 *  FRAGILE: gh's stderr messages are not versioned. If gh rewords
 *  "not logged in" / "authentication" / "no pull requests found", matches
 *  fall through to `unknown` and the UI loses the actionable recovery copy.
 *  The parametrized table tests in `github.test.ts` pin the current strings;
 *  if gh bumps a major and they drift, those tests are the tripwire. */
export function classifyGhError(err: unknown): PrResult<GhUnavailableSource> {
  const e = err as {
    code?: string | number;
    killed?: boolean;
    signal?: string;
    stderr?: string;
  };
  const ghUnavailable = (
    code: GhUnavailableCode,
  ): PrResult<GhUnavailableSource> => ({
    kind: "unavailable",
    source: { provider: GH_PROVIDER, code },
  });
  if (e.code === "ENOENT") return ghUnavailable("not-installed");
  // execFile sets killed=true when the timeout fires and sends SIGTERM.
  if (e.killed === true || e.signal === "SIGTERM") {
    return ghUnavailable("timed-out");
  }
  const stderr = (e.stderr ?? "").toLowerCase();
  // gh emits the same "none of the git remotes" prefix for two situations:
  // no remote pointing at a known GitHub host (so no PR can exist), and a
  // GH_HOST matching no remote (a config failure the user must see), so the
  // specific refusal text is matched rather than the shared prefix.
  const ABSENT_STDERR = [
    "point to a known github host",
    "no pull requests found",
    "no git remotes found",
  ];
  if (ABSENT_STDERR.some((s) => stderr.includes(s))) {
    return { kind: "absent" };
  }
  if (
    stderr.includes("not logged in") ||
    stderr.includes("authentication") ||
    stderr.includes("gh auth login")
  ) {
    return ghUnavailable("not-authenticated");
  }
  return ghUnavailable("unknown");
}
