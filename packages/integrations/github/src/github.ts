/** Pure gh-CLI helpers — no I/O, no node-only APIs. The server's
 *  `meta/github.ts` adapter wraps these with process spawning and channel
 *  publisher wiring. */

import { match, P } from "ts-pattern";
import type { GitHubPrInfo, PrResult, PrUnavailableSource } from "./schemas.ts";

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
 */
type CheckOutcome = "fail" | "pending" | "pass";

function classifyCheck(check: {
  __typename?: string;
  status?: string;
  conclusion?: string;
  state?: string;
}): CheckOutcome {
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
  rollup:
    | Array<{
        __typename?: string;
        status?: string;
        conclusion?: string;
        state?: string;
      }>
    | undefined,
): GitHubPrInfo["checks"] {
  if (!rollup || rollup.length === 0) return null;
  // "fail" is terminal — short-circuit; "pending" is sticky until something fails.
  let worst: CheckOutcome = "pass";
  for (const check of rollup) {
    const outcome = classifyCheck(check);
    if (outcome === "fail") return "fail";
    if (outcome === "pending") worst = "pending";
  }
  return worst;
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
export function classifyGhError(err: unknown): PrResult {
  const e = err as {
    code?: string | number;
    killed?: boolean;
    signal?: string;
    stderr?: string;
  };
  const ghUnavailable = (
    code: Extract<PrUnavailableSource, { provider: "gh" }>["code"],
  ): PrResult => ({
    kind: "unavailable",
    source: { provider: "gh", code },
  });
  if (e.code === "ENOENT") return ghUnavailable("not-installed");
  // execFile sets killed=true when the timeout fires and sends SIGTERM.
  if (e.killed === true || e.signal === "SIGTERM") {
    return ghUnavailable("timed-out");
  }
  const stderr = (e.stderr ?? "").toLowerCase();
  if (
    stderr.includes("not logged in") ||
    stderr.includes("authentication") ||
    stderr.includes("gh auth login")
  ) {
    return ghUnavailable("not-authenticated");
  }
  if (stderr.includes("no pull requests found")) {
    return { kind: "absent" };
  }
  return ghUnavailable("unknown");
}

/** Compare two PR resolution states for equality. Reads gh-shaped fields
 *  on `ok.value` — lives with the gh schemas rather than alongside
 *  provider-neutral `PrResult` scaffolding. Generalize when a second
 *  provider forces `ok.value` to widen. */
export function prResultEqual(a: PrResult, b: PrResult): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  if (a.kind === "ok" && b.kind === "ok") {
    return (
      a.value.number === b.value.number &&
      a.value.title === b.value.title &&
      a.value.url === b.value.url &&
      a.value.state === b.value.state &&
      a.value.checks === b.value.checks
    );
  }
  if (a.kind === "unavailable" && b.kind === "unavailable") {
    // Compare the tagged source: provider + code. Both are the typed
    // discriminators; the display reason derives from them via
    // `reasonForSource` and doesn't need its own comparison.
    return (
      a.source.provider === b.source.provider && a.source.code === b.source.code
    );
  }
  // "pending" and "absent" have no payload — kind equality is enough.
  return true;
}
