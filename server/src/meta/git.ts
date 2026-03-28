/**
 * Git metadata provider — resolves repo/branch info and watches .git/HEAD.
 *
 * Three triggers:
 * 1. CWD change (via OSC 7) → re-resolves + restarts HEAD watcher
 * 2. .git/HEAD change (via fs.watch) → re-resolves on branch switch/checkout
 * 3. Any prompt in a non-git dir → re-resolves to detect `git init`
 */

import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { simpleGit } from "simple-git";
import type { GitInfo, TerminalMetadata } from "kolu-common";
import type { TerminalEntry } from "../terminals.ts";
import { emitMetadata } from "./index.ts";
import { log } from "../log.ts";

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
function gitInfoEqual(a: GitInfo | null, b: GitInfo | null): boolean {
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
 * Resolves git info on CWD change and HEAD change, emits only on value change.
 */
export function startGitProvider(
  entry: TerminalEntry,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "git", terminal: terminalId });
  let lastCwd = entry.metadata.cwd;
  let stopHeadWatch = watchGitHead(entry.metadata.cwd, handleHeadChange);

  plog.info({ cwd: lastCwd }, "started");

  // Resolve immediately for initial CWD
  void resolve(entry.metadata.cwd);

  function onMetadata(meta: TerminalMetadata) {
    const cwdChanged = meta.cwd !== lastCwd;
    if (cwdChanged) {
      plog.info({ from: lastCwd, to: meta.cwd }, "cwd changed, re-resolving");
      lastCwd = meta.cwd;
      // Restart HEAD watcher for new directory
      stopHeadWatch();
      stopHeadWatch = watchGitHead(meta.cwd, handleHeadChange);
      void resolve(meta.cwd);
    } else if (entry.metadata.git === null && hasGitDir(meta.cwd)) {
      // Re-resolve when .git appears — detects `git init` in the current dir
      // without spawning a git process on every prompt in non-git dirs
      void resolve(meta.cwd);
    }
  }

  function handleHeadChange() {
    plog.info("HEAD changed, re-resolving");
    void resolve(lastCwd);
  }

  async function resolve(cwd: string) {
    const git = await resolveGitInfo(cwd);
    if (gitInfoEqual(git, entry.metadata.git)) return;
    // Start HEAD watcher when a repo appears (e.g. after `git init`)
    if (entry.metadata.git === null && git !== null) {
      stopHeadWatch();
      stopHeadWatch = watchGitHead(cwd, handleHeadChange);
    }
    entry.metadata.git = git;
    // Clear PR when git context changes (branch switch) — PR provider will re-resolve
    entry.metadata.pr = null;
    plog.info({ repo: git?.repoName, branch: git?.branch }, "git info updated");
    emitMetadata(entry, terminalId);
  }

  entry.emitter.on("metadata", onMetadata);

  return () => {
    entry.emitter.off("metadata", onMetadata);
    stopHeadWatch();
    plog.info("stopped");
  };
}
