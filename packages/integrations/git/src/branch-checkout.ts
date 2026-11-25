/**
 * WHERE A BRANCH IS CHECKED OUT — asked of git by `(repository, branch)`,
 * once ({@link branchCheckout}) or for as long as somebody is listening
 * ({@link subscribeBranchCheckout}).
 *
 * The answer is git's own: `git worktree list --porcelain` names every
 * checkout of the repository and the branch each one is on, and the
 * repository's root is the one rule `resolveGitInfo` reads `mainRepoRoot`
 * by ({@link repositoryRootOf}). So any path inside a repository — its root,
 * a linked worktree, a subfolder of either — answers the same root.
 *
 * ## What re-asks it
 *
 * Every way the answer can move rewrites one of two things:
 *
 *  - the `worktrees` entry of the shared git dir: `git worktree add` and
 *    `git worktree remove` add or drop a folder inside it, which changes the
 *    entry's own stat. `subscribeRepoChange` does not see this — it watches
 *    the main checkout's HEAD, reflog, index and working tree, and none of
 *    them is written;
 *  - the `HEAD` of a checkout: a `git switch` to or from the branch, in any
 *    worktree. Every checkout the last listing named is watched, the main one
 *    included, and the set is re-armed after each listing.
 *
 * A re-ask that finds the same answer says nothing.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { createDirFilenameWatcher, type WatchAsker } from "kolu-io";
import type { Logger } from "kolu-shared";
import { backgroundGit } from "./background.ts";
import {
  GIT_QUERY_TIMEOUT_MS,
  resolveGitCommonDir,
  WATCHER_DEBOUNCE_MS,
} from "./git-dir.ts";
import { watchGitHead } from "./head-watcher.ts";
import { repositoryRootOf } from "./resolve.ts";
import type { BranchCheckout } from "./schemas.ts";

const execFileAsync = promisify(execFile);

/** One checkout a listing named: its folder, and the branch it is on (none
 *  for a detached HEAD or the bare repository's own entry). */
interface Listed {
  readonly path: string;
  readonly branch: string | null;
}

/** `git worktree list --porcelain`, read: one entry per blank-line-separated
 *  block. A `prunable` entry is a checkout whose folder is gone; it is no
 *  place the branch can be worked on, so it is left out. */
export function parseWorktreeList(porcelain: string): ReadonlyArray<Listed> {
  const out: Listed[] = [];
  for (const block of porcelain.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((line) => line !== "");
    const at = lines.find((line) => line.startsWith("worktree "));
    if (at === undefined) continue;
    if (lines.some((line) => line === "bare" || line.startsWith("prunable")))
      continue;
    const ref = lines.find((line) => line.startsWith("branch "));
    out.push({
      path: at.slice("worktree ".length),
      branch:
        ref === undefined
          ? null
          : ref.slice("branch ".length).replace(/^refs\/heads\//, ""),
    });
  }
  return out;
}

/** The answer, and every checkout the listing named — what the HEAD
 *  watchers are armed on. */
interface Reading {
  readonly answer: BranchCheckout;
  readonly listed: ReadonlyArray<string>;
}

const NOT_A_REPOSITORY: Reading = {
  answer: { kind: "not-a-repository" },
  listed: [],
};

async function read(
  repoPath: string,
  branch: string,
  log?: Logger,
): Promise<Reading> {
  // simple-git refuses a folder that does not exist before git is asked; a
  // path that is no folder is no repository.
  const folder = await fs.promises.stat(repoPath).then(
    (stat) => stat.isDirectory(),
    () => false,
  );
  if (!folder) return NOT_A_REPOSITORY;
  try {
    const { root } = await repositoryRootOf(backgroundGit(repoPath), repoPath);
    const { stdout } = await execFileAsync(
      "git",
      ["worktree", "list", "--porcelain"],
      { cwd: repoPath, encoding: "utf-8", timeout: GIT_QUERY_TIMEOUT_MS },
    );
    const listed = parseWorktreeList(stdout);
    const on = listed.find((one) => one.branch === branch);
    return {
      answer: {
        kind: "repository",
        root,
        checkout:
          on === undefined ? { kind: "none" } : { kind: "at", path: on.path },
      },
      listed: listed.map((one) => one.path),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/not a git repository/i.test(message)) return NOT_A_REPOSITORY;
    log?.warn(
      { err: message, repoPath, branch },
      "git: could not read where a branch is checked out",
    );
    return {
      answer: { kind: "unavailable", reason: message.trim() },
      listed: [],
    };
  }
}

/** WHERE `branch` IS CHECKED OUT in the repository at `repoPath`, asked
 *  once. Never throws: git not answering is the `unavailable` arm. */
export async function branchCheckout(
  repoPath: string,
  branch: string,
  log?: Logger,
): Promise<BranchCheckout> {
  return (await read(repoPath, branch, log)).answer;
}

/** Two answers that say the same thing. */
export function branchCheckoutEqual(
  a: BranchCheckout,
  b: BranchCheckout,
): boolean {
  switch (a.kind) {
    case "not-a-repository":
      return b.kind === a.kind;
    case "unavailable":
      return b.kind === a.kind && b.reason === a.reason;
    case "repository":
      return (
        b.kind === "repository" &&
        b.root === a.root &&
        b.checkout.kind === a.checkout.kind &&
        (a.checkout.kind !== "at" ||
          (b.checkout.kind === "at" && b.checkout.path === a.checkout.path))
      );
    default:
      return a satisfies never;
  }
}

/** The shared git dir's `worktrees` entry: a worktree added or removed
 *  changes its stat. Refcounted per shared git dir, like the HEAD watcher. */
const worktreesWatcher = createDirFilenameWatcher({
  resolveDir: resolveGitCommonDir,
  filename: "worktrees",
  debounceMs: WATCHER_DEBOUNCE_MS,
  logLabel: "git: worktrees",
});

/** Test-only barrier and teardown for the `worktrees` watcher, as the HEAD
 *  watcher has them. */
export const _settledSharedWorktreesWatchers = worktreesWatcher._whenSettled;
export const _resetSharedWorktreesWatchers = worktreesWatcher._reset;

/** WHERE `branch` IS CHECKED OUT, for as long as the caller listens: the
 *  answer as it stands, then every answer that differs from the last. One
 *  question in flight at a time; a trigger during one asks once more after
 *  it. Answers the unsubscribe. */
export function subscribeBranchCheckout(
  repoPath: string,
  branch: string,
  asker: WatchAsker,
  onAnswer: (answer: BranchCheckout) => void,
  log?: Logger,
): () => void {
  let stopped = false;
  let last: BranchCheckout | null = null;
  let asking = false;
  let again = false;
  /** The HEAD watcher of every checkout the last listing named. */
  const heads = new Map<string, () => void>();

  const rearm = (listed: ReadonlyArray<string>): void => {
    const want = new Set(listed);
    for (const [path, stop] of heads) {
      if (want.has(path)) continue;
      stop();
      heads.delete(path);
    }
    for (const path of want) {
      if (heads.has(path)) continue;
      heads.set(path, watchGitHead(path, asker, ask, log));
    }
  };

  function ask(): void {
    if (stopped) return;
    if (asking) {
      again = true;
      return;
    }
    asking = true;
    void read(repoPath, branch, log).then((reading) => {
      asking = false;
      if (stopped) return;
      rearm(reading.listed);
      if (last === null || !branchCheckoutEqual(last, reading.answer)) {
        last = reading.answer;
        onAnswer(reading.answer);
      }
      if (again) {
        again = false;
        ask();
      }
    });
  }

  const unwatchWorktrees = worktreesWatcher.watch(repoPath, asker, ask, log);
  ask();
  return () => {
    stopped = true;
    unwatchWorktrees();
    for (const stop of heads.values()) stop();
    heads.clear();
  };
}
