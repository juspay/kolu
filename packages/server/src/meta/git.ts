/**
 * Git metadata provider — thin adapter around `subscribeGitInfo` from
 * kolu-git. The resolve + HEAD-watch + re-resolve loop lives in the
 * integration; this file wires the loop into the server's channels:
 *
 *   cwd:<id>        → watcher.setCwd
 *   onChange(info)  → trackRecentRepo + updateServerMetadata + publish git:<id>
 *
 * For remote terminals, `subscribeGitInfo` is host-aware: pass an
 * executor (the terminal's `Host`) and the same code path polls the
 * remote machine's git instead of the controller's local fs. No
 * parallel "remote-git.ts" module — one function, two backends.
 */

import { subscribeGitInfo } from "kolu-git";
import { trackRecentRepo } from "../activity.ts";
import { getHost } from "../host/registry.ts";
import { log } from "../log.ts";
import { terminalChannels } from "../publisher.ts";
import type { TerminalProcess } from "../terminal-registry.ts";
import { updateServerMetadata } from "./state.ts";

export function startGitProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({
    provider: "git",
    terminal: terminalId,
    hostId: entry.meta.hostId,
  });
  plog.debug({ cwd: entry.meta.cwd }, "started");

  const host = getHost(entry.meta.hostId);
  const executor = host && host.kind === "remote-ssh" ? host : undefined;

  const watcher = subscribeGitInfo(
    entry.meta.cwd,
    (git) => {
      if (git) trackRecentRepo(git.mainRepoRoot, git.repoName);
      updateServerMetadata(entry, terminalId, (m) => {
        m.git = git;
      });
      terminalChannels.git(terminalId).publish(git);
      plog.debug(
        { repo: git?.repoName, branch: git?.branch },
        "git info updated",
      );
    },
    plog,
    executor,
  );

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
