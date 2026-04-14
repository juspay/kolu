/**
 * Local diff review — powers the "Review" right-panel tab (issue #514 phase 1).
 *
 * Two operations:
 *   - `getStatus(repoPath)` → files changed vs HEAD (tracked + untracked)
 *   - `getDiff(repoPath, filePath)` → old/new content + a unified diff
 *     pre-shaped for `@git-diff-view/solid`'s `DiffView` data prop
 *
 * The diff is produced by `diff.createPatch` on the pair of file contents
 * (HEAD vs working tree) — same Myers algorithm git uses, no shell-out and
 * no `--no-index` quirks for untracked files.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { simpleGit } from "simple-git";
import { createPatch } from "diff";
import {
  GitChangeStatusSchema,
  type GitChangedFile,
  type GitChangeStatus,
  type GitDiffOutput,
} from "kolu-common";

/**
 * Working-tree status vs HEAD.
 *
 * Returns one entry per modified, added, deleted, renamed, copied,
 * conflicted, or untracked file. Ignored files are excluded. The `status`
 * letter reflects the most significant change (working tree preferred
 * over index when both are set).
 */
/** Coerce a raw porcelain letter into the typed enum, falling back to "?"
 *  for anything unexpected (defensive against future simple-git additions). */
function toChangeStatus(letter: string): GitChangeStatus {
  const parsed = GitChangeStatusSchema.safeParse(letter);
  return parsed.success ? parsed.data : "?";
}

export async function getStatus(repoPath: string): Promise<GitChangedFile[]> {
  const git = simpleGit(repoPath);
  const status = await git.status();

  // `files` covers tracked changes; `not_added` covers untracked paths.
  // Deduplicate via `path` — status rows may overlap with not_added for
  // intent-to-add paths.
  const seen = new Map<string, GitChangedFile>();
  for (const f of status.files) {
    // working_dir takes precedence; fall back to index.
    const letter = f.working_dir !== " " ? f.working_dir : f.index;
    seen.set(f.path, { path: f.path, status: toChangeStatus(letter) });
  }
  for (const p of status.not_added) {
    if (!seen.has(p)) seen.set(p, { path: p, status: "?" });
  }

  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Read the HEAD version of `filePath` as a string.
 * Returns empty string for paths not present in HEAD (e.g. newly added).
 */
async function readHeadContent(
  repoPath: string,
  filePath: string,
): Promise<string> {
  const git = simpleGit(repoPath);
  try {
    return await git.show([`HEAD:${filePath}`]);
  } catch {
    // Expected for files not in HEAD (newly added or untracked). Treat as empty base.
    return "";
  }
}

/**
 * Read the working-tree version of `filePath`.
 * Returns empty string for deleted paths.
 */
async function readWorkingContent(
  repoPath: string,
  filePath: string,
): Promise<string> {
  try {
    return await fs.readFile(path.join(repoPath, filePath), "utf8");
  } catch {
    // Expected for deleted files. Treat as empty target.
    return "";
  }
}

/**
 * Compute the diff of one file vs HEAD and return it pre-shaped for
 * `@git-diff-view/solid`'s `DiffView` data prop.
 *
 * For untracked files: oldContent is empty, newContent is the working-tree
 * file — `createPatch` handles the empty-base case natively.
 */
export async function getDiff(
  repoPath: string,
  filePath: string,
): Promise<GitDiffOutput> {
  const [oldContent, newContent] = await Promise.all([
    readHeadContent(repoPath, filePath),
    readWorkingContent(repoPath, filePath),
  ]);

  // `@git-diff-view/core`'s parser expects each entry in `hunks[]` to be
  // a complete unified-diff string carrying its own `--- / +++ / @@`
  // header (see `parseDiffHeader` in `diff-parse.ts` — the parser scans
  // forward for `---` and then `+++` before it will recognize any `@@`
  // blocks). `createPatch` already produces exactly this shape, so we
  // hand it over as a single-entry array instead of splitting it into
  // per-`@@` fragments (which would strip the header and lose the diff).
  const hunks =
    oldContent === newContent
      ? []
      : [createPatch(filePath, oldContent, newContent)];

  return {
    oldFileName: oldContent ? filePath : null,
    newFileName: newContent ? filePath : null,
    oldContent,
    newContent,
    hunks,
  };
}
