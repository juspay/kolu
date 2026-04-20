/**
 * GitHub PR metadata provider — resolves PR info for the current branch.
 *
 * Subscribes to "git:<id>" (not the aggregated "metadata" channel).
 * Publishes via updateServerMetadata() — no downstream providers depend on PR changes.
 * Also polls periodically (PRs can be created/updated externally at any time).
 *
 * ┌─ FUTURE: PrProvider extraction ──────────────────────────────────────┐
 * │ When Bitbucket (`bkt`) support lands (srid/agency#10), the forge-    │
 * │ specific bits — the `gh`/`bkt` binary, provider-specific classifier, │
 * │ schemas — get pulled behind a narrow `PrProvider` interface:         │
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
import {
  GitHubPrStateSchema,
  classifyGhError,
  deriveCheckStatus,
  prResultEqual,
  type PrResult,
} from "kolu-github";
import type { GitInfo } from "kolu-common";
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
    logGhResolveFailure(err, result);
    return result;
  }
}

/** Route a failed `gh pr view` result to the appropriate log level.
 *  absent = expected (branch has no PR) → debug.
 *  unavailable with code `unknown` = an actual unexpected error → error.
 *  unavailable with any other code = degraded-but-recoverable → warn. */
function logGhResolveFailure(err: unknown, result: PrResult): void {
  const ctx = { err: String(err), result: result.kind };
  if (result.kind === "absent") {
    log.debug(ctx, "gh pr view: no PR for branch");
    return;
  }
  if (result.kind === "unavailable" && result.source.code === "unknown") {
    log.error(ctx, "gh pr view: unknown error");
    return;
  }
  log.warn(
    result.kind === "unavailable" ? { ...ctx, code: result.source.code } : ctx,
    "gh pr view: unavailable",
  );
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
