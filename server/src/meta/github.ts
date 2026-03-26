/**
 * GitHub PR metadata provider — resolves PR info for the current branch.
 *
 * Listens to "metadata" events for branch changes, and polls periodically
 * (PRs can be created/updated externally at any time).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitHubPrInfo, TerminalMetadata } from "kolu-common";
import type { TerminalEntry } from "../terminals.ts";
import { emitMetadata } from "./index.ts";
import { log } from "../log.ts";

const execFileAsync = promisify(execFile);

const POLL_INTERVAL_MS = 30_000;
const GH_TIMEOUT_MS = 5_000;

/** Derive combined check status from statusCheckRollup entries. */
function deriveCheckStatus(
  rollup:
    | Array<{ status?: string; conclusion?: string; state?: string }>
    | undefined,
): GitHubPrInfo["checks"] {
  if (!rollup || rollup.length === 0) return null;

  let hasFailure = false;
  let hasPending = false;

  for (const check of rollup) {
    // GitHub Actions use status/conclusion; commit statuses use state
    const state = check.state?.toUpperCase();
    const status = check.status?.toUpperCase();
    const conclusion = check.conclusion?.toUpperCase();

    if (
      state === "FAILURE" ||
      state === "ERROR" ||
      conclusion === "FAILURE" ||
      conclusion === "CANCELLED"
    ) {
      hasFailure = true;
    } else if (
      state === "PENDING" ||
      status === "IN_PROGRESS" ||
      status === "QUEUED" ||
      status === "WAITING" ||
      !conclusion
    ) {
      if (status !== "COMPLETED") hasPending = true;
    }
  }

  if (hasFailure) return "fail";
  if (hasPending) return "pending";
  return "pass";
}

/** Look up the GitHub PR for the current branch. Returns null on any failure. */
async function resolveGitHubPr(
  repoRoot: string,
  branch: string,
): Promise<GitHubPrInfo | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["pr", "view", branch, "--json", "number,title,url,statusCheckRollup"],
      { cwd: repoRoot, timeout: GH_TIMEOUT_MS },
    );
    const data = JSON.parse(stdout);
    return {
      number: data.number,
      title: data.title,
      url: data.url,
      checks: deriveCheckStatus(data.statusCheckRollup),
    };
  } catch {
    return null;
  }
}

/** Compare two GitHubPrInfo values for equality. */
function prInfoEqual(a: GitHubPrInfo | null, b: GitHubPrInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.number === b.number &&
    a.title === b.title &&
    a.url === b.url &&
    a.checks === b.checks
  );
}

/**
 * Start the GitHub PR metadata provider for a terminal entry.
 * Resolves PR info on branch change and polls every 30s.
 */
export function startGitHubPrProvider(entry: TerminalEntry): () => void {
  const plog = log.child({ provider: "github-pr" });
  let lastBranch: string | undefined = entry.metadata.git?.branch;
  let lastRepoRoot: string | undefined = entry.metadata.git?.repoRoot;

  plog.debug({ branch: lastBranch }, "started");

  // Resolve immediately if we have git context
  if (lastBranch && lastRepoRoot) {
    void resolve(lastRepoRoot, lastBranch);
  }

  function onMetadata(meta: TerminalMetadata) {
    const branch = meta.git?.branch;
    const repoRoot = meta.git?.repoRoot;
    if (branch === lastBranch && repoRoot === lastRepoRoot) return;
    plog.debug(
      { from: lastBranch, to: branch },
      "branch changed, re-resolving",
    );
    lastBranch = branch;
    lastRepoRoot = repoRoot;
    if (branch && repoRoot) {
      void resolve(repoRoot, branch);
    } else {
      // No longer in a git repo
      if (entry.metadata.pr !== null) {
        entry.metadata.pr = null;
        emitMetadata(entry);
      }
    }
  }

  async function resolve(repoRoot: string, branch: string) {
    const pr = await resolveGitHubPr(repoRoot, branch);
    if (prInfoEqual(pr, entry.metadata.pr)) return;
    entry.metadata.pr = pr;
    plog.debug(
      pr ? { pr: pr.number, title: pr.title } : { pr: null },
      "pr info updated",
    );
    emitMetadata(entry);
  }

  // Periodic poll — PRs can be created/updated externally
  const pollTimer = setInterval(() => {
    if (lastBranch && lastRepoRoot) {
      plog.debug("poll tick");
      void resolve(lastRepoRoot, lastBranch);
    }
  }, POLL_INTERVAL_MS);

  entry.emitter.on("metadata", onMetadata);

  return () => {
    entry.emitter.off("metadata", onMetadata);
    clearInterval(pollTimer);
    plog.debug("stopped");
  };
}
