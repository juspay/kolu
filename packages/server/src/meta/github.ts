/**
 * GitHub PR metadata provider — thin adapter around `kolu-github`.
 *
 * The integration owns everything gh-specific: `KOLU_GH_BIN` lookup, the
 * `gh pr view` spawn, branch-change dedup, the 30s polling loop, failure
 * classification and routing. This file just wires the watcher to the
 * server's `git:` channel and pushes resolved `PrResult` values into
 * terminal metadata via `updateServerLiveMetadata` — `pr` is a live
 * field, so PR-poll churn doesn't trigger session autosaves.
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

import { localGitHubPrProvider } from "kolu-github";
import { log } from "../log.ts";
import { terminalChannels } from "../publisher.ts";
import type { TerminalProcess } from "../terminal-registry.ts";
import { updateServerLiveMetadata } from "./state.ts";

export function startGitHubPrProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "github-pr", terminal: terminalId });

  // `localGitHubPrProvider` spawns `gh pr view` against a local `cwd`. For
  // an SSH-wrapped tile the right `cwd` lives on the remote, and the
  // user's `gh` auth lives on the remote too — local invocation would
  // either ENOENT or pull the wrong PR. Skip cleanly; Phase 2b's
  // `remoteGitHubPrProvider` will dispatch through the kolu-agent.
  if (entry.meta.location.kind !== "local") {
    plog.debug({ location: entry.meta.location }, "skipping non-local");
    return () => {};
  }

  plog.debug("started");

  const watcher = localGitHubPrProvider.subscribe((pr) => {
    updateServerLiveMetadata(entry, terminalId, (m) => {
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

  // Channel events are host-tagged. Guard on `host === null` before
  // feeding `repoRoot` into a local `gh pr view --cwd repoRoot` — a
  // remote-host path would silently ENOENT. With this provider skipped
  // for non-local terminals (above), the guard is defence-in-depth.
  const cleanup = terminalChannels.git(terminalId).consume({
    onEvent: (event) => {
      if (event.host !== null) return;
      const git = event.payload;
      watcher.setGit(git?.repoRoot ?? null, git?.branch ?? null);
    },
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  return () => {
    cleanup();
    watcher.stop();
  };
}
