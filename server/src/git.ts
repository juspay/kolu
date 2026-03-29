/**
 * Git worktree operations — create, remove, and list worktrees.
 *
 * Worktrees are stored in `.worktrees/<name>` relative to the main repo root.
 * Names are random adjective-noun pairs from a Nix-provided word list.
 */

import path from "node:path";
import fs from "node:fs";
import { simpleGit } from "simple-git";
import type { WorktreeEntry } from "kolu-common";
import { log } from "./log.ts";

// --- Word list for random worktree names ---

interface WordList {
  adjectives: string[];
  nouns: string[];
}

let wordList: WordList | null = null;

function getWordList(): WordList {
  if (wordList) return wordList;

  const wordsPath = process.env.KOLU_WORKTREE_WORDS;
  if (wordsPath && fs.existsSync(wordsPath)) {
    wordList = JSON.parse(fs.readFileSync(wordsPath, "utf-8")) as WordList;
    log.info(
      {
        path: wordsPath,
        adjectives: wordList.adjectives.length,
        nouns: wordList.nouns.length,
      },
      "loaded worktree word list",
    );
  } else {
    // Fallback for dev without Nix
    wordList = {
      adjectives: ["calm", "bold", "warm", "keen", "swift"],
      nouns: ["brook", "ridge", "vale", "peak", "cove"],
    };
    log.warn("KOLU_WORKTREE_WORDS not set, using fallback word list");
  }
  return wordList;
}

function randomWorktreeName(): string {
  const { adjectives, nouns } = getWordList();
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]!;
  const noun = nouns[Math.floor(Math.random() * nouns.length)]!;
  return `${adj}-${noun}`;
}

// --- Git helpers ---

/** Resolve the main repo root from any path inside a repo (including worktrees). */
async function resolveMainRepoRoot(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  const gitCommonDir = (await git.revparse(["--git-common-dir"])).trim();
  return path.dirname(fs.realpathSync(path.resolve(repoPath, gitCommonDir)));
}

/** Detect the default branch name on the remote (e.g. "main" or "master"). */
async function detectDefaultBranch(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  try {
    const ref = (
      await git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"])
    ).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    try {
      await git.raw(["rev-parse", "--verify", "origin/main"]);
      return "main";
    } catch {
      return "master";
    }
  }
}

// --- Worktree operations ---

/**
 * Create a git worktree with a random name, branching from origin/<default>.
 * Retries with a new name on collision.
 */
export async function worktreeCreate(
  repoPath: string,
): Promise<{ path: string; branch: string; isNew: boolean }> {
  const mainRoot = await resolveMainRepoRoot(repoPath);
  const git = simpleGit(mainRoot);
  const defaultBranch = await detectDefaultBranch(mainRoot);

  log.info({ mainRoot }, "fetching origin");
  await git.fetch("origin");

  // Try up to 5 times to find a unique name
  for (let attempt = 0; attempt < 5; attempt++) {
    const branch = randomWorktreeName();
    const targetPath = path.join(mainRoot, ".worktrees", branch);

    if (fs.existsSync(targetPath)) {
      log.info({ branch }, "name collision, retrying");
      continue;
    }

    log.info(
      { targetPath, branch, base: `origin/${defaultBranch}` },
      "creating worktree",
    );
    await git.raw([
      "worktree",
      "add",
      targetPath,
      "-b",
      branch,
      `origin/${defaultBranch}`,
    ]);

    return { path: targetPath, branch, isNew: true };
  }

  // Extremely unlikely — 48×48 = 2304 possible names
  throw new Error("Failed to generate unique worktree name after 5 attempts");
}

/** Remove a git worktree by path. */
export async function worktreeRemove(worktreePath: string): Promise<void> {
  const mainRoot = await resolveMainRepoRoot(worktreePath);
  const git = simpleGit(mainRoot);
  log.info({ worktreePath }, "removing worktree");
  await git.raw(["worktree", "remove", worktreePath, "--force"]);
}

/** List all worktrees for a repo, excluding the main worktree. */
export async function worktreeList(repoPath: string): Promise<WorktreeEntry[]> {
  const mainRoot = await resolveMainRepoRoot(repoPath);
  const git = simpleGit(mainRoot);
  const output = (await git.raw(["worktree", "list", "--porcelain"])).trim();
  if (!output) return [];

  const entries: WorktreeEntry[] = [];
  let currentPath: string | null = null;
  let currentBranch: string | null = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (currentPath !== null && currentPath !== mainRoot) {
        entries.push({ path: currentPath, branch: currentBranch });
      }
      currentPath = line.slice("worktree ".length);
      currentBranch = null;
    } else if (line.startsWith("branch ")) {
      currentBranch = line.slice("branch ".length).replace("refs/heads/", "");
    }
  }
  if (currentPath !== null && currentPath !== mainRoot) {
    entries.push({ path: currentPath, branch: currentBranch });
  }

  return entries;
}
