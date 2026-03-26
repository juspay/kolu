/**
 * Git metadata provider — resolves repo/branch info and watches .git/HEAD.
 *
 * Two triggers:
 * 1. Listens to "metadata" events for CWD changes → re-resolves + restarts HEAD watcher
 * 2. Watches .git/HEAD via fs.watch → re-resolves on branch switch/checkout
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
    return {
      repoRoot,
      repoName: path.basename(repoRoot),
      worktreePath: cwd,
      branch,
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
export function startGitProvider(entry: TerminalEntry): () => void {
  const plog = log.child({ provider: "git" });
  let lastCwd = entry.metadata.cwd;
  let stopHeadWatch = watchGitHead(entry.metadata.cwd, handleHeadChange);

  plog.debug({ cwd: lastCwd }, "started");

  // Resolve immediately for initial CWD
  void resolve(entry.metadata.cwd);

  function onMetadata(meta: TerminalMetadata) {
    if (meta.cwd === lastCwd) return;
    plog.debug({ from: lastCwd, to: meta.cwd }, "cwd changed, re-resolving");
    lastCwd = meta.cwd;
    // Restart HEAD watcher for new directory
    stopHeadWatch();
    stopHeadWatch = watchGitHead(meta.cwd, handleHeadChange);
    void resolve(meta.cwd);
  }

  function handleHeadChange() {
    plog.debug("HEAD changed, re-resolving");
    void resolve(lastCwd);
  }

  async function resolve(cwd: string) {
    const git = await resolveGitInfo(cwd);
    if (gitInfoEqual(git, entry.metadata.git)) return;
    entry.metadata.git = git;
    // Clear PR when git context changes (branch switch) — PR provider will re-resolve
    entry.metadata.pr = null;
    plog.debug(
      { repo: git?.repoName, branch: git?.branch },
      "git info updated",
    );
    emitMetadata(entry);
  }

  entry.emitter.on("metadata", onMetadata);

  return () => {
    entry.emitter.off("metadata", onMetadata);
    stopHeadWatch();
    plog.debug("stopped");
  };
}
