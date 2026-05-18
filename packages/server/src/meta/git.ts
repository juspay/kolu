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
import { getHost } from "../host/registry.ts";
import { log } from "../log.ts";
import { terminalChannels } from "../publisher.ts";
import type { TerminalProcess } from "../terminal-registry.ts";
import { startRemoteGit } from "./remote-git.ts";
import { updateServerMetadata } from "./state.ts";

export function startGitProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "git", terminal: terminalId });
  plog.debug({ cwd: entry.meta.cwd, hostId: entry.meta.hostId }, "started");

  // Remote terminals can't use the kolu-git subscribeGitInfo path —
  // it shells out via `execSync` against the controller's local fs,
  // which has no idea what `/home/toor/code/kolu` on the remote is.
  // Fall over to the host-aware fetcher, which routes git invocations
  // through the helper.
  const host = getHost(entry.meta.hostId);
  const useRemote = host !== undefined && host.kind === "remote-ssh";

  const onChange = (git: import("kolu-git/schemas").GitInfo | null): void => {
    if (git) trackRecentRepo(git.mainRepoRoot, git.repoName);
    updateServerMetadata(entry, terminalId, (m) => {
      m.git = git;
    });
    terminalChannels.git(terminalId).publish(git);
    plog.debug(
      { repo: git?.repoName, branch: git?.branch },
      "git info updated",
    );
  };

  const watcher = useRemote
    ? startRemoteGit(host, entry.meta.cwd, onChange, plog)
    : subscribeGitInfo(entry.meta.cwd, onChange, plog);

  const cleanup = terminalChannels.cwd(terminalId).consume({
    onEvent: (cwd) => watcher.setCwd(cwd),
    onError: (err) => plog.error({ err }, "publisher subscription failed"),
  });

  return () => {
    cleanup();
    watcher.stop();
    plog.debug("stopped");
  };
}
