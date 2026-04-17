/**
 * Git metadata provider — resolves repo/branch info and watches .git/HEAD.
 *
 * Subscribes to "cwd:<id>" (not the aggregated "metadata" channel).
 * Publishes on "git:<id>" so downstream providers (github) react without cycles.
 *
 * Three triggers:
 * 1. CWD change (via cwd channel) → re-resolves + restarts HEAD watcher
 * 2. .git/HEAD change (via fs.watch) → re-resolves on branch switch/checkout
 * 3. CWD event in a non-git dir where .git now exists → detects `git init`
 */

import type { GitInfo } from "kolu-common";
import {
  resolveGitInfo,
  watchGitHead,
  gitInfoEqual,
  hasGitDir,
} from "kolu-git";
import type { TerminalProcess } from "../terminals.ts";
import { subscribeForTerminal, publishForTerminal } from "../publisher.ts";
import { updateServerMetadata } from "./index.ts";
import { log } from "../log.ts";
import { trackRecentRepo } from "../activity.ts";

/**
 * Start the git metadata provider for a terminal entry.
 * Subscribes to "cwd" channel, publishes on "git" channel.
 * Resolves git info on CWD change and HEAD change, emits only on value change.
 */
export function startGitProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "git", terminal: terminalId });
  const meta = entry.info.meta;
  let lastCwd = meta.cwd;
  let stopHeadWatch = watchGitHead(meta.cwd, handleHeadChange, plog);

  plog.debug({ cwd: lastCwd }, "started");

  // Resolve immediately for initial CWD
  void resolve(meta.cwd);

  function onCwdChange(newCwd: string) {
    if (newCwd === lastCwd) {
      // CWD unchanged — check for `git init` in current dir
      if (entry.info.meta.git === null && hasGitDir(newCwd)) {
        void resolve(newCwd);
      }
      return;
    }
    plog.debug({ from: lastCwd, to: newCwd }, "cwd changed, re-resolving");
    lastCwd = newCwd;
    // Restart HEAD watcher for new directory
    stopHeadWatch();
    stopHeadWatch = watchGitHead(newCwd, handleHeadChange, plog);
    void resolve(newCwd);
  }

  function handleHeadChange() {
    plog.debug("HEAD changed, re-resolving");
    void resolve(lastCwd);
  }

  async function resolve(cwd: string) {
    const result = await resolveGitInfo(cwd, plog);
    const git: GitInfo | null = result.ok ? result.value : null;
    if (!result.ok && result.error.code !== "NOT_A_REPO") {
      plog.error({ code: result.error.code }, "git resolution failed");
    }
    const m = entry.info.meta;
    if (gitInfoEqual(git, m.git)) return;
    // Start HEAD watcher when a repo appears (e.g. after `git init`)
    if (m.git === null && git !== null) {
      stopHeadWatch();
      stopHeadWatch = watchGitHead(cwd, handleHeadChange, plog);
    }
    // Track repo in persistent recent repos list
    if (git) trackRecentRepo(git.mainRepoRoot, git.repoName);
    // Write git only — the pr slot is owned by the github provider, which
    // subscribes to the `git:` channel below and clears/re-resolves on change.
    updateServerMetadata(entry, terminalId, (m) => {
      m.git = git;
    });
    plog.debug(
      { repo: git?.repoName, branch: git?.branch },
      "git info updated",
    );
    // Notify downstream providers (github) via dedicated channel
    publishForTerminal("git", terminalId, git);
  }

  const abort = new AbortController();
  subscribeForTerminal("cwd", terminalId, abort.signal, onCwdChange);

  return () => {
    abort.abort();
    stopHeadWatch();
    plog.debug("stopped");
  };
}
