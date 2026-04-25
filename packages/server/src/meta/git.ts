/**
 * Git metadata provider — thin adapter around `subscribeGitInfo` from
 * kolu-git. The resolve + HEAD-watch + re-resolve loop lives in the
 * integration; this file wires the loop into the server's channels:
 *
 *   cwd:<id>        → watcher.setCwd
 *   onChange(info)  → trackRecentRepo + updateServerMetadata + publish git:<id>
 *
 * Downstream providers (github) subscribe to `git:<id>` for branch/repo
 * deltas without needing to know about cwd-change semantics.
 */

import { subscribeGitInfo } from "kolu-git";
import { trackRecentRepo } from "../activity.ts";
import { log } from "../log.ts";
import { publishForTerminal, subscribeForTerminal } from "../publisher.ts";
import type { TerminalProcess } from "../terminals.ts";
import { updateServerMetadata } from "./index.ts";

export function startGitProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "git", terminal: terminalId });
  plog.debug({ cwd: entry.info.meta.cwd }, "started");

  const watcher = subscribeGitInfo(
    entry.info.meta.cwd,
    (git) => {
      if (git) trackRecentRepo(git.mainRepoRoot, git.repoName);
      updateServerMetadata(entry, terminalId, (m) => {
        m.git = git;
      });
      publishForTerminal("git", terminalId, git);
      plog.debug(
        { repo: git?.repoName, branch: git?.branch },
        "git info updated",
      );
    },
    plog,
  );

  const abort = new AbortController();
  subscribeForTerminal("cwd", terminalId, abort.signal, (cwd) =>
    watcher.setCwd(cwd),
  );

  return () => {
    abort.abort();
    watcher.stop();
    plog.debug("stopped");
  };
}
