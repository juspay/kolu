/**
 * GitHub PR metadata provider — thin adapter around `kolu-github`.
 *
 * The integration owns everything gh-specific: `KOLU_GH_BIN` lookup, the
 * `gh pr view` spawn, branch-change dedup, the 30s polling loop, failure
 * classification and routing. This file just wires the watcher to the
 * server's `git:` channel and pushes resolved `PrResult` values into
 * terminal metadata via `updateServerMetadata`.
 *
 * ┌─ FUTURE: PrProvider extraction ──────────────────────────────────────┐
 * │ When Bitbucket (`bkt`) support lands (srid/agency#10), a sibling     │
 * │ `kolu-bkt` will export the same `subscribeBitbucketPr` shape. This   │
 * │ adapter dispatches by forge detection (origin remote URL — same      │
 * │ axis `/do`'s forge step uses). `PrResult` stays shared; each impl    │
 * │ owns its own classifier + pinned binary env var (`KOLU_GH_BIN`,      │
 * │ `KOLU_BKT_BIN`). Don't extract a common `PrProvider` interface       │
 * │ before bkt exists — its stderr taxonomy is what will tell you where  │
 * │ the seam goes.                                                       │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import { subscribeGitHubPr } from "kolu-github";
import { log } from "../log.ts";
import { subscribeForTerminal } from "../publisher.ts";
import type { TerminalProcess } from "../terminals.ts";
import { updateServerMetadata } from "./index.ts";

export function startGitHubPrProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "github-pr", terminal: terminalId });
  plog.debug("started");

  const watcher = subscribeGitHubPr((pr) => {
    updateServerMetadata(entry, terminalId, (m) => {
      m.pr = pr;
    });
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
  }, plog);

  const abort = new AbortController();
  subscribeForTerminal("git", terminalId, abort.signal, (git) => {
    watcher.setGit(git?.repoRoot ?? null, git?.branch ?? null);
  });

  return () => {
    abort.abort();
    watcher.stop();
  };
}
