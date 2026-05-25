/**
 * Git metadata provider — thin adapter around `GitInfoProvider` from
 * kolu-git. The resolve + HEAD-watch + re-resolve loop lives in the
 * integration; this file wires the loop into the server's channels:
 *
 *   cwd:<id>        → watcher.setCwd
 *   onChange(info)  → trackRecentRepo + updateServerMetadata + publish git:<id>
 *
 * The published payload is wrapped in `HostTagged<GitInfo>` so downstream
 * consumers (`meta/github.ts`) can guard on origin host before treating
 * paths as locally resolvable.
 *
 * Phase 0 picks `localGitInfoProvider` unconditionally — every terminal
 * has `location.kind === "local"`. Phase 2b will introduce a per-host
 * dispatch that picks `localGitInfoProvider` vs `remoteGitInfoProvider`
 * based on `entry.meta.location`.
 *
 * Downstream providers (github) subscribe to `git:<id>` for branch/repo
 * deltas without needing to know about cwd-change semantics.
 */

import { type GitInfoProvider, localGitInfoProvider } from "kolu-git";
import { trackRecentRepo } from "../activity.ts";
import { log } from "../log.ts";
import { terminalChannels } from "../publisher.ts";
import type { TerminalProcess } from "../terminal-registry.ts";
import { updateServerMetadata } from "./state.ts";

/** Pick the right provider for the terminal's host. Phase 0 always
 *  returns the local provider — the remote variant lands in Phase 2b. */
function pickProvider(entry: TerminalProcess): GitInfoProvider {
  if (entry.meta.location.kind !== "local") {
    // Defensive: Phase 0 never reaches here because no remote terminals
    // exist yet. Returning the local provider would feed remote-host
    // paths into local `subscribeGitInfo`, producing wrong answers. The
    // local provider is safe as a fallback only because no remote-host
    // terminal will be in the registry until Phase 1.
    log.warn(
      { location: entry.meta.location, terminalId: entry.info.id },
      "non-local terminal in Phase 0 — no remote GitInfoProvider yet",
    );
  }
  return localGitInfoProvider;
}

export function startGitProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "git", terminal: terminalId });
  plog.debug({ cwd: entry.meta.cwd }, "started");

  const provider = pickProvider(entry);
  // Resolve once: `host` for the wrapped channel payload. Stays in scope
  // for the watcher closure so downstream consumers see the same host
  // tag on every emit while this terminal lives.
  const host =
    entry.meta.location.kind === "ssh" ? entry.meta.location.host : null;

  const watcher = provider.subscribe(
    entry.meta.cwd,
    (git) => {
      if (git) trackRecentRepo(git.mainRepoRoot, git.repoName);
      updateServerMetadata(entry, terminalId, (m) => {
        m.git = git;
      });
      terminalChannels.git(terminalId).publish({ host, payload: git });
      plog.debug(
        { repo: git?.repoName, branch: git?.branch },
        "git info updated",
      );
    },
    plog,
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
