/**
 * GitHub PR metadata provider — resolves PR info for the current branch.
 *
 * Subscribes to "git:<id>" (not the aggregated "metadata" channel).
 * Publishes via updateServerMetadata() — no downstream providers depend on PR changes.
 * Also polls periodically (PRs can be created/updated externally at any time).
 *
 * ┌─ FUTURE: PrProvider extraction ──────────────────────────────────────┐
 * │ When Bitbucket (`bkt`) support lands (srid/agency#10), the forge-    │
 * │ specific bits here — `GH_BIN`, `gh pr view` invocation, gh-stderr    │
 * │ classifier — get pulled behind a narrow `PrProvider` interface:      │
 * │                                                                      │
 * │   interface PrProvider {                                             │
 * │     readonly kind: "gh" | "bkt";                                     │
 * │     resolve(repoRoot: string): Promise<PrResult>;                    │
 * │   }                                                                  │
 * │                                                                      │
 * │ Dispatch by forge detection (origin remote URL — same axis that      │
 * │ `/do`'s forge step uses). `PrResult` stays shared; each impl owns    │
 * │ its own classifier + pinned binary env var (`KOLU_GH_BIN`,           │
 * │ `KOLU_BKT_BIN`). Don't extract before the second impl exists —       │
 * │ the bkt stderr taxonomy is what will tell you where the seam goes.   │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { match, P } from "ts-pattern";
import {
  GitHubPrStateSchema,
  type GitHubPrInfo,
  type GitInfo,
  type PrResult,
  type PrUnavailableSource,
} from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { subscribeForTerminal } from "../publisher.ts";
import { updateServerMetadata } from "./index.ts";
import { log } from "../log.ts";

const execFileAsync = promisify(execFile);

const POLL_INTERVAL_MS = 30_000;
const GH_TIMEOUT_MS = 5_000;

/** Pinned `gh` binary path. `KOLU_GH_BIN` is set by both the packaged
 *  wrapper and the dev shell via `nix/env.nix` → `shell.nix` / `default.nix`.
 *  Nix is the only supported runtime; fail fast if the env var is missing
 *  rather than silently falling through to PATH (which would resolve to a
 *  different `gh` than the one kolu ships with). */
const GH_BIN = (() => {
  const v = process.env.KOLU_GH_BIN;
  if (!v) {
    throw new Error(
      "KOLU_GH_BIN is not set. Run kolu through the Nix wrapper or `nix develop`.",
    );
  }
  return v;
})();

/**
 * Derive combined check status from statusCheckRollup entries.
 *
 * The rollup contains two GraphQL types, discriminated by __typename:
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

/**
 * Classify a single rollup entry into fail / pending / pass.
 *
 * Two GitHub types share the rollup; `__typename` discriminates which enum to
 * dispatch on. Within each branch, `match` + `P.union` groups the failure-
 * and pending-class buckets so adding a new value (e.g. a future GitHub
 * conclusion) is a one-line edit.
 */
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

/** Shape returned by `gh pr view --json ...`. */
interface GhPrViewResult {
  number: number;
  title: string;
  url: string;
  state: string;
  statusCheckRollup?: Parameters<typeof deriveCheckStatus>[0];
}

/** Classify a `gh pr view` failure.
 *
 *  `gh pr view` exits non-zero for a genuine "no PR on this branch" (common,
 *  expected) AND for environmental failures (binary missing, not
 *  authenticated, hit timeout). The original code collapsed all of these into
 *  a single `null` — distinguish them here so the UI can surface the
 *  actionable ones. Only a positive match on gh's "no pull requests found"
 *  stderr counts as absent; anything else unrecognized is treated as
 *  unavailable rather than silently shown as "no PR." */
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

/**
 * Look up the GitHub PR for the current branch.
 *
 * Uses `gh pr view` which resolves via git remote tracking — it finds the PR
 * opened from this repo (or fork) for the current branch, unlike `gh pr list
 * --head <name>` which matches by branch name alone and picks up unrelated
 * fork PRs.
 */
async function resolveGitHubPr(repoRoot: string): Promise<PrResult> {
  try {
    const { stdout } = await execFileAsync(
      GH_BIN,
      ["pr", "view", "--json", "number,title,url,state,statusCheckRollup"],
      { cwd: repoRoot, timeout: GH_TIMEOUT_MS },
    );
    const data = JSON.parse(stdout) as GhPrViewResult;
    return {
      kind: "ok",
      value: {
        number: data.number,
        title: data.title,
        url: data.url,
        state: GitHubPrStateSchema.parse(data.state.toLowerCase()),
        checks: deriveCheckStatus(data.statusCheckRollup),
      },
    };
  } catch (err) {
    const result = classifyGhError(err);
    log.debug({ err: String(err), result: result.kind }, "gh pr view failed");
    return result;
  }
}

/** Compare two PR resolution states for equality. */
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

/**
 * Start the GitHub PR metadata provider for a terminal entry.
 *
 * Subscribes to the `git:` channel — the git provider publishes its
 * current state (including the initial resolve) on that channel, so there
 * is no need to peek at `entry.info.meta.git` at startup. Also polls
 * every 30s to pick up PRs created/updated externally.
 *
 * This provider owns the `pr` slot end-to-end: it clears `pr` immediately
 * on any branch change (so stale pr info doesn't linger while the async
 * `gh pr view` is in flight) and writes the new value when the resolve
 * completes.
 */
export function startGitHubPrProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "github-pr", terminal: terminalId });
  let lastBranch: string | undefined;
  let lastRepoRoot: string | undefined;

  plog.debug("started");

  function onGitChange(git: GitInfo | null) {
    const branch = git?.branch;
    const repoRoot = git?.repoRoot;
    if (branch === lastBranch && repoRoot === lastRepoRoot) return;
    plog.debug(
      { from: lastBranch, to: branch },
      "branch changed, re-resolving",
    );
    lastBranch = branch;
    lastRepoRoot = repoRoot;
    // Mark pr pending — the previous value is tied to the old branch and is
    // now stale. If we still have a repo, the async resolve below will
    // overwrite with the new branch's result. If we don't, pending is the
    // final state until a new repo is attached.
    if (entry.info.meta.pr.kind !== "pending") {
      updateServerMetadata(entry, terminalId, (m) => {
        m.pr = { kind: "pending" };
      });
    }
    if (branch && repoRoot) {
      void resolve(repoRoot);
    }
  }

  async function resolve(repoRoot: string) {
    const pr = await resolveGitHubPr(repoRoot);
    if (prResultEqual(pr, entry.info.meta.pr)) return;
    plog.debug(
      pr.kind === "ok"
        ? {
            pr: pr.value.number,
            title: pr.value.title,
            state: pr.value.state,
            checks: pr.value.checks,
          }
        : { pr: pr.kind },
      "pr info updated",
    );
    updateServerMetadata(entry, terminalId, (m) => {
      m.pr = pr;
    });
  }

  // Periodic poll — PRs can be created/updated externally
  const pollTimer = setInterval(() => {
    if (lastBranch && lastRepoRoot) {
      plog.debug("poll tick");
      void resolve(lastRepoRoot);
    }
  }, POLL_INTERVAL_MS);

  const abort = new AbortController();
  subscribeForTerminal("git", terminalId, abort.signal, onGitChange);

  return () => {
    abort.abort();
    clearInterval(pollTimer);
    plog.debug("stopped");
  };
}
