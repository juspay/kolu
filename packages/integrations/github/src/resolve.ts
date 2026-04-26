/** Runtime resolver — spawns `gh pr view`, classifies failures, owns the
 *  branch-change + polling loop. Node-only (uses `node:child_process`);
 *  browser-bound callers should import only from `./schemas.ts` via the
 *  `kolu-common/pr` subpath, which re-exports schemas + display helpers but
 *  not this module. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { trackDiagnosticResource, type Logger } from "anyagent";
import { classifyGhError, deriveCheckStatus, prResultEqual } from "./github.ts";
import { GitHubPrStateSchema, type PrResult } from "./schemas.ts";

const execFileAsync = promisify(execFile);

const POLL_INTERVAL_MS = 30_000;
const GH_TIMEOUT_MS = 5_000;

/** Lazy lookup for the pinned `gh` binary path. Reads `KOLU_GH_BIN` set by
 *  the Nix wrapper / dev shell (see `nix/env.nix`). Throws on first call —
 *  not at module load — so importing this file into a browser bundle
 *  doesn't blow up on `process.env` access; the runtime error surfaces at
 *  the first resolve attempt, where it belongs. */
let ghBinCached: string | null = null;
function getGhBin(): string {
  if (ghBinCached !== null) return ghBinCached;
  const v = process.env.KOLU_GH_BIN;
  if (!v) {
    throw new Error(
      "KOLU_GH_BIN is not set. Run kolu through the Nix wrapper or `nix develop`.",
    );
  }
  ghBinCached = v;
  return v;
}

/** Shape returned by `gh pr view --json ...`. */
interface GhPrViewResult {
  number: number;
  title: string;
  url: string;
  state: string;
  statusCheckRollup?: Parameters<typeof deriveCheckStatus>[0];
}

/** Look up the GitHub PR for the current branch.
 *
 *  Uses `gh pr view` which resolves via git remote tracking — it finds the
 *  PR opened from this repo (or fork) for the current branch, unlike
 *  `gh pr list --head <name>` which matches by branch name alone and picks
 *  up unrelated fork PRs.
 *
 *  Logs failures at the appropriate level when a logger is passed:
 *  absent→debug (expected), unknown→error (actual bug), other→warn
 *  (degraded-but-recoverable). */
export async function resolveGitHubPr(
  repoRoot: string,
  log?: Logger,
): Promise<PrResult> {
  try {
    const { stdout } = await execFileAsync(
      getGhBin(),
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
    if (log) logGhResolveFailure(err, result, log);
    return result;
  }
}

/** Route a failed `gh pr view` result to the appropriate log level.
 *  absent = expected (branch has no PR) → debug.
 *  unavailable with code `unknown` = an actual unexpected error → error.
 *  unavailable with any other code = degraded-but-recoverable → warn. */
function logGhResolveFailure(
  err: unknown,
  result: PrResult,
  log: Logger,
): void {
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

/** Watcher handle returned by `subscribeGitHubPr`. */
export interface GitHubPrWatcher {
  /** Feed the latest git state. Repo+branch dedup happens internally; a
   *  real change triggers a synchronous `{ kind: "pending" }` emit followed
   *  by an async resolve that emits the result. Pass `null`s when the
   *  terminal leaves a repo. */
  setGit: (repoRoot: string | null, branch: string | null) => void;
  /** Cancel the poll timer and stop accepting updates. */
  stop: () => void;
}

/** Subscribe to GitHub PR changes for a terminal.
 *
 *  Mirrors `kolu-git`'s `subscribeGitInfo` shape: the caller wires the
 *  watcher to its own git source (channel subscription, signal, whatever)
 *  via `setGit`, and receives resolved `PrResult` values through `onChange`.
 *
 *  Owns: branch-change dedup (via `prResultEqual`), pending emission on
 *  branch change (so stale PR info doesn't linger while `gh pr view` is in
 *  flight), and a 30s polling loop that re-resolves on the last-seen
 *  repo/branch (PRs can be created/updated externally).
 *
 *  Does not own: the git source, metadata publishing, terminal lifecycle —
 *  those stay with the caller. */
export function subscribeGitHubPr(
  onChange: (pr: PrResult) => void,
  log?: Logger,
): GitHubPrWatcher {
  let lastBranch: string | null = null;
  let lastRepoRoot: string | null = null;
  let lastPr: PrResult = { kind: "pending" };
  let stopped = false;

  function emit(pr: PrResult): void {
    if (stopped || prResultEqual(pr, lastPr)) return;
    lastPr = pr;
    onChange(pr);
  }

  async function fetchAndEmit(repoRoot: string): Promise<void> {
    const pr = await resolveGitHubPr(repoRoot, log);
    emit(pr);
  }

  function setGit(repoRoot: string | null, branch: string | null): void {
    if (branch === lastBranch && repoRoot === lastRepoRoot) return;
    log?.debug(
      { from: lastBranch, to: branch },
      "branch changed, re-resolving",
    );
    lastBranch = branch;
    lastRepoRoot = repoRoot;
    // Emit pending so stale PR info doesn't linger while resolve is in
    // flight. If we already last-emitted pending, dedup inside `emit`
    // makes this a no-op.
    emit({ kind: "pending" });
    if (branch && repoRoot) void fetchAndEmit(repoRoot);
  }

  const pollTimer = setInterval(() => {
    if (lastBranch && lastRepoRoot) {
      log?.debug({ branch: lastBranch }, "poll tick");
      void fetchAndEmit(lastRepoRoot);
    }
  }, POLL_INTERVAL_MS);
  const untrackPollTimer = trackDiagnosticResource({
    kind: "timer",
    label: "GitHub PR poll",
    owner: "kolu-github",
    target: null,
    details: () => ({
      intervalMs: POLL_INTERVAL_MS,
      branch: lastBranch,
      repoRoot: lastRepoRoot,
    }),
  });

  return {
    setGit,
    stop: () => {
      stopped = true;
      clearInterval(pollTimer);
      untrackPollTimer();
      log?.debug({ branch: lastBranch }, "stopped");
    },
  };
}
