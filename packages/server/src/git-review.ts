/**
 * Local diff review — powers the "Review" right-panel tab (issue #514 phase 1).
 *
 * Two operations:
 *   - `getStatus(repoPath)` → files changed vs HEAD (tracked + untracked)
 *   - `getDiff(repoPath, filePath)` → old/new content + the raw unified
 *     diff string from git, pre-shaped for `@git-diff-view/solid`'s
 *     `DiffView` data prop.
 *
 * The diff itself is produced by `git diff` — we just pipe its output
 * through. Untracked files go through `git diff --no-index`, which exits
 * 1 by design when files differ; we capture stdout regardless.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { simpleGit } from "simple-git";
import {
  GitChangeStatusSchema,
  type GitChangedFile,
  type GitChangeStatus,
  type GitDiffOutput,
} from "kolu-common";
import { log } from "./log.ts";
import { resolveUnder } from "./safe-path.ts";

const execFileP = promisify(execFile);

/** Coerce a raw porcelain letter into the typed enum, falling back to "?"
 *  for anything unexpected (defensive against future simple-git additions). */
function toChangeStatus(letter: string): GitChangeStatus {
  const parsed = GitChangeStatusSchema.safeParse(letter);
  return parsed.success ? parsed.data : "?";
}

/**
 * Working-tree status vs HEAD. Returns one entry per modified, added,
 * deleted, renamed, copied, conflicted, or untracked file. Ignored files
 * are excluded. The `status` letter reflects the most significant change
 * (working tree preferred over index when both are set).
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
    const letter = f.working_dir !== " " ? f.working_dir : f.index;
    seen.set(f.path, { path: f.path, status: toChangeStatus(letter) });
  }
  for (const p of status.not_added) {
    if (!seen.has(p)) seen.set(p, { path: p, status: "?" });
  }

  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Read the HEAD version of `relPath`. Returns empty string when the path
 * is absent from HEAD (newly added / untracked); any other git failure
 * (missing HEAD in an empty repo, permission denied, corrupted object)
 * propagates.
 */
async function readHeadContent(
  repoPath: string,
  relPath: string,
): Promise<string> {
  const git = simpleGit(repoPath);
  try {
    return await git.show([`HEAD:${relPath}`]);
  } catch (err) {
    // Narrow to the one expected failure: simple-git wraps the fatal
    // line, which for a missing path reads either
    //   "fatal: path '<p>' does not exist in 'HEAD'"
    // or
    //   "fatal: Path '<p>' exists on disk, but not in 'HEAD'"
    const msg = err instanceof Error ? err.message : "";
    if (/does not exist in |exists on disk, but not in /.test(msg)) return "";
    throw err;
  }
}

/**
 * Read the working-tree version of a pre-resolved absolute path. Returns
 * empty string only for ENOENT ("the file was deleted"); all other
 * errors (permissions, EISDIR, etc.) propagate.
 */
async function readWorkingContent(fileAbs: string): Promise<string> {
  try {
    return await fs.readFile(fileAbs, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/**
 * Run git and return stdout, surviving the `--no-index` exit-1 convention.
 *
 * `git diff --no-index` exits 1 when the two paths differ — that's its
 * successful signal, not an error. `execFile` rejects on any non-zero
 * exit, so we catch exit-1 and keep its stdout; anything else propagates.
 */
async function gitOutput(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP("git", args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    // `execFile`'s rejection carries `code` (exit status, number) and
    // `stdout`/`stderr` on the error object. NodeJS.ErrnoException types
    // `code` as `string`, which doesn't match — cast through the shape
    // we actually observe.
    const e = err as { code?: number; stdout?: string };
    if (e.code === 1 && typeof e.stdout === "string") return e.stdout;
    throw err;
  }
}

/**
 * Compute the unified diff of one file vs HEAD and return it pre-shaped
 * for `@git-diff-view/solid`'s `DiffView` data prop.
 *
 * `git diff HEAD -- <file>` handles tracked files (modified / staged /
 * deleted) directly. Untracked files emit nothing on that path, so we
 * fall back to `git diff --no-index /dev/null <file>` to synthesize the
 * diff against an empty base.
 */
export async function getDiff(
  repoPath: string,
  filePath: string,
): Promise<GitDiffOutput> {
  const { abs, rel } = resolveUnder(repoPath, filePath);

  const [oldContent, newContent, tracked] = await Promise.all([
    readHeadContent(repoPath, rel),
    readWorkingContent(abs),
    gitOutput(repoPath, ["diff", "HEAD", "--", rel]),
  ]);

  const rawDiff =
    tracked.trim().length > 0
      ? tracked
      : await gitOutput(repoPath, [
          "diff",
          "--no-index",
          "--",
          "/dev/null",
          // Use the pre-validated absolute path — `--no-index`'s behavior
          // w.r.t. cwd is less universally stable than `git diff HEAD --`,
          // and `abs` already went through `resolveUnder`.
          abs,
        ]);

  if (!rawDiff.trim().length) {
    // Both `git diff HEAD --` and `--no-index` produced nothing for a
    // file the client asked about. Legitimate cases (mode-only change
    // that's already been reset, race with an external `git reset`) are
    // possible but rare — log so operators can spot a pattern.
    log.warn({ filePath: rel }, "git-review: empty diff for requested file");
  }

  return {
    oldFileName: oldContent ? rel : null,
    newFileName: newContent ? rel : null,
    oldContent,
    newContent,
    hunks: rawDiff ? [rawDiff] : [],
  };
}
