import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PrGitContext, ForgeAdapter, PrResult } from "anyforge";
import { logPrResolveFailure } from "anyforge";
import type { Logger } from "kolu-shared";
import {
  classifyGhError,
  GH_PR_VIEW_JSON_FIELDS,
  type GhPrViewJson,
  prInfoFromGhView,
} from "./github.ts";
import type { GhUnavailableSource } from "./schemas.ts";

const execFileAsync = promisify(execFile);

const GH_TIMEOUT_MS = 5_000;

function requireGhBin(): string {
  const bin = process.env.KOLU_GH_BIN;
  if (!bin) {
    throw new Error(
      "KOLU_GH_BIN is not set. Run kolu through the Nix wrapper or `nix develop`.",
    );
  }
  return bin;
}

/** Look up the GitHub PR for a BRANCH in a repository.
 *
 *  Uses `gh pr view <branch>`, which resolves via git remote tracking and
 *  finds the PR opened from this repo (or a fork) for that branch, unlike
 *  `gh pr list --head <name>`, which matches by branch name alone and picks
 *  up unrelated fork PRs. The branch is named explicitly because gh asked
 *  without one answers about whatever is checked out in `repoRoot`
 *  (juspay/kolu#2376). */
export async function resolveGitHubPr(
  git: PrGitContext,
  log?: Logger,
): Promise<PrResult<GhUnavailableSource>> {
  try {
    const { stdout } = await execFileAsync(
      requireGhBin(),
      git.branch === ""
        ? ["pr", "view", "--json", GH_PR_VIEW_JSON_FIELDS]
        : ["pr", "view", git.branch, "--json", GH_PR_VIEW_JSON_FIELDS],
      { cwd: git.repoRoot, timeout: GH_TIMEOUT_MS },
    );
    const data = JSON.parse(stdout) as GhPrViewJson;
    return {
      kind: "ok",
      value: prInfoFromGhView(data),
    };
  } catch (err) {
    const result = classifyGhError(err);
    if (log) logPrResolveFailure(err, result, log, "gh pr view");
    return result;
  }
}

/** The gh adapter — the `ForgeAdapter` the host injects into `subscribePr`,
 *  typed at its concrete `GhUnavailableSource` so `subscribePr` infers
 *  `S = GhUnavailableSource`. */
export const githubForgeAdapter = {
  kind: "github" as const,
  resolve: (git, _cause, log) => resolveGitHubPr(git, log),
} satisfies ForgeAdapter<GhUnavailableSource>;
