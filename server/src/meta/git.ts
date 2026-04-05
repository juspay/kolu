/**
 * Git metadata provider — resolves repo/branch info and watches .git/HEAD.
 *
 * Reacts to cwdSignal changes (not a publisher channel).
 * Sets gitSignal so downstream providers (github) react without cycles.
 *
 * Three triggers:
 * 1. CWD change (via cwdSignal) → re-resolves + restarts HEAD watcher
 * 2. .git/HEAD change (via fs.watch) → re-resolves on branch switch/checkout
 * 3. CWD event in a non-git dir where .git now exists → detects `git init`
 */

import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { simpleGit } from "simple-git";
import type { GitInfo } from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { getCwdSignal, setGitSignal, watch } from "../signals.ts";
import { updateMetadata } from "./index.ts";
import { log } from "../log.ts";
import { trackRecentRepo } from "../state.ts";

const DEBOUNCE_MS = 150;

/** Fast check: does a .git entry exist in this directory? (stat, not a git subprocess) */
function hasGitDir(cwd: string): boolean {
  try {
    fs.accessSync(path.join(cwd, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** Resolve git context for a directory. Returns null if not in a git repo. */
export async function resolveGitInfo(cwd: string): Promise<GitInfo | null> {
  try {
    const git = simpleGit(cwd);
    const repoRoot = (await git.revparse(["--show-toplevel"])).trim();
    let branch: string;
    try {
      branch = (await git.raw(["symbolic-ref", "--short", "HEAD"])).trim();
    } catch {
      branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
    }
    // --git-common-dir returns the shared .git dir; for worktrees it points
    // back to the main repo's .git, letting us derive the real repo name.
    // The path is relative to cwd (where simple-git runs), not repoRoot.
    // realpathSync normalizes symlinks (e.g. /tmp → /private/tmp on macOS)
    // so the comparison with repoRoot (which git already resolved) is reliable.
    const gitCommonDir = (await git.revparse(["--git-common-dir"])).trim();
    const mainRepoRoot = path.dirname(
      fs.realpathSync(path.resolve(cwd, gitCommonDir)),
    );
    const isWorktree = mainRepoRoot !== repoRoot;
    return {
      repoRoot,
      repoName: path.basename(mainRepoRoot),
      worktreePath: cwd,
      branch,
      isWorktree,
      mainRepoRoot,
    };
  } catch {
    return null;
  }
}

/**
 * Watch .git/HEAD for changes (branch switches, checkout, etc.).
 * Returns a cleanup function. Returns a no-op for non-git directories.
 */
function watchGitHead(cwd: string, onChange: () => void): () => void {
  let gitDir: string;
  try {
    const result = execSync("git rev-parse --git-dir", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    gitDir = path.resolve(cwd, result.trim());
  } catch {
    return () => {};
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(gitDir, (_, filename) => {
      if (filename !== "HEAD") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, DEBOUNCE_MS);
    });
  } catch (err) {
    log.debug({ err, gitDir }, "git: failed to watch git dir");
    return () => {};
  }

  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}

/** Compare two GitInfo values for equality. */
export function gitInfoEqual(a: GitInfo | null, b: GitInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.repoRoot === b.repoRoot &&
    a.branch === b.branch &&
    a.worktreePath === b.worktreePath
  );
}

/**
 * Start the git metadata provider for a terminal entry.
 * Reacts to cwdSignal, sets gitSignal for downstream providers.
 * Resolves git info on CWD change and HEAD change, emits only on value change.
 */
export function startGitProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "git", terminal: terminalId });
  const meta = entry.info.meta;
  let lastCwd = meta.cwd;
  let stopHeadWatch = watchGitHead(meta.cwd, handleHeadChange);

  plog.info({ cwd: lastCwd }, "started");

  // No explicit initial resolve — watch() fires the initial value synchronously.

  function onCwdChange(newCwd: string) {
    if (newCwd === lastCwd) {
      // CWD unchanged — check for `git init` in current dir
      if (entry.info.meta.git === null && hasGitDir(newCwd)) {
        void resolve(newCwd);
      }
      return;
    }
    plog.info({ from: lastCwd, to: newCwd }, "cwd changed, re-resolving");
    lastCwd = newCwd;
    // Restart HEAD watcher for new directory
    stopHeadWatch();
    stopHeadWatch = watchGitHead(newCwd, handleHeadChange);
    void resolve(newCwd);
  }

  function handleHeadChange() {
    plog.info("HEAD changed, re-resolving");
    void resolve(lastCwd);
  }

  async function resolve(cwd: string) {
    const git = await resolveGitInfo(cwd);
    const m = entry.info.meta;
    if (gitInfoEqual(git, m.git)) return;
    // Start HEAD watcher when a repo appears (e.g. after `git init`)
    if (m.git === null && git !== null) {
      stopHeadWatch();
      stopHeadWatch = watchGitHead(cwd, handleHeadChange);
    }
    // Track repo in persistent recent repos list
    if (git) trackRecentRepo(git.mainRepoRoot, git.repoName);
    // Clear PR when git context changes (branch switch) — PR provider will re-resolve
    updateMetadata(entry, terminalId, (m) => {
      m.git = git;
      m.pr = null;
    });
    plog.info({ repo: git?.repoName, branch: git?.branch }, "git info updated");
    // Set git signal for downstream providers (github)
    setGitSignal(terminalId, git);
  }

  // Watch cwdSignal reactively — fires on each CWD change
  const cwdAccessor = getCwdSignal(terminalId);
  let stopWatch = () => {};
  if (cwdAccessor) {
    stopWatch = watch(cwdAccessor, onCwdChange);
  }

  return () => {
    stopWatch();
    stopHeadWatch();
    plog.info("stopped");
  };
}
