/**
 * Local diff review — powers the "Review" right-panel tab (issue #514 phase 1).
 *
 * Two operations:
 *   - `getStatus(repoPath)` → files changed vs HEAD (tracked + untracked)
 *   - `getDiff(repoPath, filePath)` → old/new content + hunks, pre-shaped for
 *     `@git-diff-view/solid`'s `DiffView` data prop
 *
 * Hunks are extracted with `diff.parsePatch` (not a hand-rolled `@@`-splitter)
 * so edge cases like `\ No newline at end of file`, section headers, and
 * multi-file diffs are handled by upstream.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { simpleGit } from "simple-git";
import { parsePatch, createPatch, type StructuredPatchHunk } from "diff";
import type { GitChangedFile, GitDiffOutput } from "kolu-common";

/**
 * Working-tree status vs HEAD.
 *
 * Returns one entry per modified, added, deleted, renamed, copied,
 * conflicted, or untracked file. Ignored files are excluded. The `status`
 * letter reflects the most significant change (working tree preferred
 * over index when both are set).
 */
export async function getStatus(repoPath: string): Promise<GitChangedFile[]> {
  const git = simpleGit(repoPath);
  const status = await git.status();

  // `files` covers tracked changes; `not_added` covers untracked paths.
  // Deduplicate via `path` — status rows may overlap with not_added for
  // intent-to-add paths.
  const seen = new Map<string, GitChangedFile>();
  for (const f of status.files) {
    // working_dir takes precedence; fall back to index.
    const letter = (f.working_dir !== " " ? f.working_dir : f.index) || "?";
    seen.set(f.path, { path: f.path, status: letter });
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
 * Re-serialize a parsed hunk back to unified-diff text with its
 * `@@ -a,b +c,d @@` header.
 */
function reserializeHunk(h: StructuredPatchHunk): string {
  const header = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
  return [header, ...h.lines].join("\n") + "\n";
}

/**
 * Compute the diff of one file vs HEAD and return it pre-shaped for
 * `@git-diff-view/solid`'s `DiffView` data prop.
 *
 * For untracked files: oldContent is empty, newContent is the working-tree
 * file, and hunks are synthesized by diffing against an empty base.
 */
export async function getDiff(
  repoPath: string,
  filePath: string,
): Promise<GitDiffOutput> {
  const [oldContent, newContent] = await Promise.all([
    readHeadContent(repoPath, filePath),
    readWorkingContent(repoPath, filePath),
  ]);

  // Use `diff.createPatch` directly on the two contents rather than
  // shelling out to `git diff HEAD`. This sidesteps the untracked-file
  // quirk (`git diff HEAD -- <untracked>` emits nothing) and the
  // `--no-index` exit-1-by-design trap, and produces a unified diff the
  // same Myers algorithm git uses. `parsePatch` then normalizes it into
  // hunks for the client renderer.
  const rawDiff = createPatch(filePath, oldContent, newContent);
  const parsed = parsePatch(rawDiff);
  const file = parsed[0];
  const hunks = file ? file.hunks.map(reserializeHunk) : [];

  return {
    oldFileName: oldContent ? filePath : null,
    newFileName: newContent ? filePath : null,
    oldContent,
    newContent,
    hunks,
  };
}
