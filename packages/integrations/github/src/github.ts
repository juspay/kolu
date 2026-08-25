/** Pure gh-CLI helpers — no I/O, no node-only APIs. `resolve.ts` wraps
 *  these with the `gh pr view` spawn; the wire shapes they produce live in
 *  `anyforge/schemas`. */

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

/**
 * Derive combined check status from GitHub's statusCheckRollup entries.
 *
 * The rollup contains two GraphQL types, discriminated by `__typename`:
 *
 * CheckRun — GitHub Actions / Apps
 *   status:     QUEUED | IN_PROGRESS | COMPLETED | WAITING | PENDING | REQUESTED
 *   conclusion: SUCCESS | FAILURE | CANCELLED | NEUTRAL | SKIPPED | STALE
 *               | STARTUP_FAILURE | TIMED_OUT | ACTION_REQUIRED | null (not yet completed)
 *
 * StatusContext — commit statuses (set via REST status API)
 *   state: SUCCESS | PENDING | FAILURE | ERROR | EXPECTED
 *
 * See: https://docs.github.com/en/graphql/reference/unions#statuscheckrollupcontext
 *
 * This is the gh-specific half — mapping GitHub's raw check vocabulary to the
 * neutral `CheckStatus`. The combine rule (fail-terminal, pending-sticky) is
 * forge-shared and lives in anyforge's `foldCheckOutcomes`.
 */

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
  // CheckRun: anything not COMPLETED is still pending.
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

export function deriveCheckStatus(
  rollup: RollupEntry[] | undefined,
): PrInfo["checks"] {
  // Pure mapping: the absent-or-empty → null decision lives entirely in
  // `foldCheckOutcomes` (an absent rollup classifies to `[]`, which it folds
  // to null), so the 'no checks configured → null' rule stays in one place.
  return foldCheckOutcomes(rollup?.map(classifyCheck) ?? []);
}

/** Per-check breakdown of the rollup — the same entries `deriveCheckStatus`
 *  collapses, kept individual so the dock's PR pip tooltip can list which
 *  specific gate is red. Returns `[]` when no checks are configured.
 *
 *  Name preference: `CheckRun.name` for Actions/Apps; `StatusContext.context`
 *  for REST commit statuses; `?` as a last-resort fallback so the array
 *  shape stays uniform even if gh returns an entry missing both. */
export function extractChecks(rollup: RollupEntry[] | undefined): CheckRun[] {
  if (!rollup) return [];
  return rollup.map((c) => ({
    name:
      c.__typename === "StatusContext"
        ? (c.context ?? "?")
        : (c.name ?? c.context ?? "?"),
    outcome: classifyCheck(c),
  }));
}

/** `--json` fields for the ONE `gh pr view` the sensor already makes. Adding
 *  a name here is adding it to that same request, not a second poll. The
 *  CLI string and the JSON type are the same list — a new field that
 *  lands in only one of them is a type error (`_ghPrViewJsonKeysMatch`). */
export const GH_PR_VIEW_JSON_FIELD_LIST = [
  "number",
  "title",
  "url",
  "state",
  "statusCheckRollup",
  "reviewDecision",
  "mergeStateStatus",
] as const;

export const GH_PR_VIEW_JSON_FIELDS = GH_PR_VIEW_JSON_FIELD_LIST.join(",");

/** Shape returned by `gh pr view --json ${GH_PR_VIEW_JSON_FIELDS}`. */
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
};

type GhPrViewJsonKeysMatch =
  Exclude<
    keyof GhPrViewJson,
    (typeof GH_PR_VIEW_JSON_FIELD_LIST)[number]
  > extends never
    ? Exclude<
        (typeof GH_PR_VIEW_JSON_FIELD_LIST)[number],
        keyof GhPrViewJson
      > extends never
      ? true
      : never
    : never;
const _ghPrViewJsonKeysMatch: GhPrViewJsonKeysMatch = true;

const decodePrState = Schema.decodeUnknownSync(PrStateSchema);
const decodeReviewDecision = Schema.decodeUnknownSync(
  Schema.NullOr(ReviewDecisionSchema),
);
const decodeMergeStateStatus = Schema.decodeUnknownSync(MergeStateStatusSchema);

/** Map gh's JSON onto `PrInfo`. Review/merge values pass through verbatim —
 *  an unknown member throws (fail-fast), which `resolveGitHubPr`'s catch
 *  turns into a classified failure rather than a silently wrong gate. */
export function prInfoFromGhView(data: GhPrViewJson): PrInfo {
  return {
    number: data.number,
    title: data.title,
    url: data.url,
    state: decodePrState(data.state.toLowerCase()),
    checks: deriveCheckStatus(data.statusCheckRollup),
    checkRuns: extractChecks(data.statusCheckRollup),
    // `""` is gh's CLI serialization of GraphQL null (no decision), not a
    // member of the enum — mapping it to `null` is carrying gh's own value
    // verbatim, not inventing a friendlier vocabulary. A non-empty unknown
    // member still throws.
    reviewDecision: decodeReviewDecision(
      data.reviewDecision === "" ? null : data.reviewDecision,
    ),
    mergeStateStatus: decodeMergeStateStatus(data.mergeStateStatus),
  };
}

/** Classify a `gh pr view` failure.
 *
 *  `gh pr view` exits non-zero for a genuine "no PR on this branch" (common,
 *  expected) AND for environmental failures (binary missing, not
 *  authenticated, hit timeout). The original code collapsed all of these into
 *  a single `null` — distinguish them here so the UI can surface the
 *  actionable ones. Only a positive match on gh's "no pull requests found"
 *  stderr counts as absent; anything else unrecognized is treated as
 *  unavailable rather than silently shown as "no PR."
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
  // Situations where a PR simply can't exist — same silent UI outcome as
  // "no PR on this branch", not a problem to warn about:
  //  - a non-GitHub remote (another forge, GitLab, …): gh refuses before
  //    any API call. Match the "known GitHub host" refusal specifically, NOT the
  //    bare "none of the git remotes" prefix — gh's remoteResolver emits a
  //    second message with that same prefix ("…correspond to the GH_HOST
  //    environment variable…") for a misconfigured GH_HOST that matches no
  //    remote. That is a real config failure the user should see, so it
  //    must fall through to `unknown` rather than be swallowed as `absent`.
  //    Known false-negative: the same refusal fires for a GitHub Enterprise
  //    remote the user hasn't run `gh auth login --hostname <ghe>` for —
  //    gh's known-host set is its authenticated hosts + the default host +
  //    github.com — where the old not-authenticated classification was
  //    correct. Indistinguishable on stderr, and a host can't be told apart
  //    from any other unknown host without configuration, so the gap stays
  //    until per-host config lands (see the anyforge Atlas note's open
  //    questions).
  //  - gh's literal "no pull requests found" for the current branch;
  //  - a repo with no remote at all.
  // This block sits before the auth check because the non-GitHub-remote
  // refusal itself suggests `gh auth login`, which would otherwise match
  // the auth branch.
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
