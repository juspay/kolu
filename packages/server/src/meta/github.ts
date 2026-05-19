/**
 * GitHub PR metadata provider — thin adapter around `kolu-github`.
 *
 * Routes the `gh pr view` invocation through the terminal's executor —
 * `localExecutor` for local terminals (gh comes off PATH via kolu's
 * Nix wrapper) and the SSH `Host` for remote ones. One code path, two
 * backends; no `KOLU_GH_BIN` fork.
 */

import { subscribeGitHubPr } from "kolu-github";
import { localExecutor } from "kolu-git/executor";
import { getHost } from "../host/registry.ts";
import { log } from "../log.ts";
import { terminalChannels } from "../publisher.ts";
import type { TerminalProcess } from "../terminal-registry.ts";
import { updateServerLiveMetadata } from "./state.ts";

export function startGitHubPrProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({
    provider: "github-pr",
    terminal: terminalId,
    hostId: entry.meta.hostId,
  });
  plog.debug("started");

  // hostId is always concrete (`"local"` or an SSH alias); resolve the
  // host and use it as the executor regardless. localExecutor is the
  // fallback when the registry has no entry — e.g. a stale terminal
  // whose host was unregistered.
  const host = getHost(entry.meta.hostId);
  const executor = host ?? localExecutor;

  const watcher = subscribeGitHubPr(
    executor,
    (pr) => {
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
    },
    plog,
  );

  const cleanup = terminalChannels.git(terminalId).consume({
    onEvent: (git) =>
      watcher.setGit(git?.repoRoot ?? null, git?.branch ?? null),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  return () => {
    cleanup();
    watcher.stop();
  };
}
