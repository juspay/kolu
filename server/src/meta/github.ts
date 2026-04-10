/**
 * GitHub PR metadata provider — resolves PR info for the current branch.
 *
 * Subscribes to "git:<id>" (not the aggregated "metadata" channel).
 * Publishes via updateMetadata() — no downstream providers depend on PR changes.
 * Also polls periodically (PRs can be created/updated externally at any time).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { match, P } from "ts-pattern";
import {
  GitHubPrStateSchema,
  type GitHubPrInfo,
  type GitInfo,
} from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { subscribeForTerminal } from "../publisher.ts";
import { updateMetadata } from "./index.ts";
import { log } from "../log.ts";

const execFileAsync = promisify(execFile);

const POLL_INTERVAL_MS = 30_000;
const GH_TIMEOUT_MS = 5_000;

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

/**
 * Look up the GitHub PR for the current branch.
 *
 * Uses `gh pr view` which resolves via git remote tracking — it finds the PR
 * opened from this repo (or fork) for the current branch, unlike `gh pr list
 * --head <name>` which matches by branch name alone and picks up unrelated
 * fork PRs.
 */
async function resolveGitHubPr(repoRoot: string): Promise<GitHubPrInfo | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", "--json", "number,title,url,state,statusCheckRollup"],
      { cwd: repoRoot, timeout: GH_TIMEOUT_MS },
    );
    const data = JSON.parse(stdout) as GhPrViewResult;
    return {
      number: data.number,
      title: data.title,
      url: data.url,
      state: GitHubPrStateSchema.parse(data.state.toLowerCase()),
      checks: deriveCheckStatus(data.statusCheckRollup),
    };
  } catch (err) {
    // gh pr view exits non-zero when no PR exists for the branch — expected.
    // Also catches gh-not-installed / auth failures; debug-log so they're discoverable.
    log.debug({ err: String(err) }, "no PR for current branch");
    return null;
  }
}

/** Compare two GitHubPrInfo values for equality. */
export function prInfoEqual(
  a: GitHubPrInfo | null,
  b: GitHubPrInfo | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.number === b.number &&
    a.title === b.title &&
    a.url === b.url &&
    a.state === b.state &&
    a.checks === b.checks
  );
}

/**
 * Start the GitHub PR metadata provider for a terminal entry.
 * Subscribes to "git" channel for branch changes, polls every 30s.
 */
export function startGitHubPrProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "github-pr", terminal: terminalId });
  const meta = entry.info.meta;
  let lastBranch: string | undefined = meta.git?.branch;
  let lastRepoRoot: string | undefined = meta.git?.repoRoot;

  plog.debug({ branch: lastBranch }, "started");

  // Resolve immediately if we have git context
  if (lastBranch && lastRepoRoot) {
    void resolve(lastRepoRoot);
  }

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
    if (branch && repoRoot) {
      void resolve(repoRoot);
    } else {
      // No longer in a git repo
      if (entry.info.meta.pr !== null) {
        updateMetadata(entry, terminalId, (m) => {
          m.pr = null;
        });
      }
    }
  }

  async function resolve(repoRoot: string) {
    const pr = await resolveGitHubPr(repoRoot);
    if (prInfoEqual(pr, entry.info.meta.pr)) return;
    plog.debug(
      pr
        ? { pr: pr.number, title: pr.title, state: pr.state, checks: pr.checks }
        : { pr: null },
      "pr info updated",
    );
    updateMetadata(entry, terminalId, (m) => {
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
