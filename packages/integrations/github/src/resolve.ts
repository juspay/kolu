/** Runtime resolver — spawns `gh pr view` and classifies failures.
 *  Node-only (uses `node:child_process`); browser-bound callers import the
 *  wire schemas from `anyforge/schemas` instead. The generic branch-change
 *  + polling loop lives in anyforge's `subscribePr`; this module is just
 *  the gh adapter it dispatches to. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PrGitContext, ForgeAdapter, PrResult } from "anyforge";
import { logPrResolveFailure } from "anyforge";
import { PrStateSchema } from "anyforge/schemas";
import type { Logger } from "kolu-shared";
import { classifyGhError, deriveCheckStatus, extractChecks } from "./github.ts";
import type { GhUnavailableSource } from "./schemas.ts";

const execFileAsync = promisify(execFile);

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
 *  up unrelated fork PRs. (That is also why only `git.repoRoot` is read
 *  from the context: gh derives branch + remote from the repo itself.)
 *
 *  Logs failures at the appropriate level when a logger is passed:
 *  absent→debug (expected), unknown→error (actual bug), other→warn
 *  (degraded-but-recoverable). */
export async function resolveGitHubPr(
  git: PrGitContext,
  log?: Logger,
): Promise<PrResult<GhUnavailableSource>> {
  try {
    const { stdout } = await execFileAsync(
      getGhBin(),
      ["pr", "view", "--json", "number,title,url,state,statusCheckRollup"],
      { cwd: git.repoRoot, timeout: GH_TIMEOUT_MS },
    );
    const data = JSON.parse(stdout) as GhPrViewResult;
    return {
      kind: "ok",
      value: {
        number: data.number,
        title: data.title,
        url: data.url,
        state: PrStateSchema.parse(data.state.toLowerCase()),
        checks: deriveCheckStatus(data.statusCheckRollup),
        checkRuns: extractChecks(data.statusCheckRollup),
      },
    };
  } catch (err) {
    const result = classifyGhError(err);
    if (log) logPrResolveFailure(err, result, log, "gh pr view");
    return result;
  }
}

/** The gh adapter — the `ForgeAdapter` the host injects into `subscribePr`.
 *  Typed at its concrete `GhUnavailableSource` so `subscribePr` infers
 *  `S = GhUnavailableSource` and its `PrResult<GhUnavailableSource>` lands
 *  in the app's closed `PrResult` without a cast (gh is the union's member).
 *
 *  Annotated with `satisfies` (not `:`) so `kind` keeps its `"github"`
 *  literal type rather than widening to `ForgeAdapter.kind: string`: the
 *  dispatcher in kolu-server derives its `ForgeKind` from this very value,
 *  so the registry key it dispatches on is forced to equal the adapter's own
 *  `kind` — they cannot drift. The closed-union failure tag (`provider: "gh"`,
 *  see `GhUnavailableSchema`) is the wire-persisted spelling of the same forge
 *  and is intentionally distinct from this in-process `kind`. */
export const githubForgeAdapter = {
  kind: "github" as const,
  resolve: resolveGitHubPr,
} satisfies ForgeAdapter<GhUnavailableSource>;
