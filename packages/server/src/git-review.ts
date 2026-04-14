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
 * Normalize a caller-supplied file path and reject anything that escapes
 * the repo root. `filePath` arrives over RPC, so the server must not
 * trust it — without this guard a crafted `../../etc/passwd` would be
 * happily read by `fs.readFile`.
 */
function resolveInRepo(repoPath: string, filePath: string): string {
  const repoAbs = path.resolve(repoPath);
  const fileAbs = path.resolve(repoAbs, filePath);
  if (fileAbs !== repoAbs && !fileAbs.startsWith(repoAbs + path.sep)) {
    throw new Error(`filePath escapes repoPath: ${filePath}`);
  }
  return fileAbs;
}

/**
 * Read the HEAD version of `filePath`. Returns empty string when the
 * path is absent from HEAD (newly added / untracked) — any other git
 * error (missing HEAD in an empty repo aside) propagates so the caller
 * can surface it.
 */
async function readHeadContent(
  repoPath: string,
  filePath: string,
): Promise<string> {
  const git = simpleGit(repoPath);
  // `cat-file -e` exits non-zero iff the object doesn't exist — a cheap,
  // specific existence probe. Only this failure is swallowed.
  try {
    await git.raw(["cat-file", "-e", `HEAD:${filePath}`]);
  } catch {
    return "";
  }
  return git.show([`HEAD:${filePath}`]);
}

/**
 * Read the working-tree version of `filePath` at a pre-resolved absolute
 * path. Returns empty string only for ENOENT ("the file was deleted"); all
 * other errors (permissions, EISDIR, etc.) propagate.
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
  const fileAbs = resolveInRepo(repoPath, filePath);

  const [oldContent, newContent, tracked] = await Promise.all([
    readHeadContent(repoPath, filePath),
    readWorkingContent(fileAbs),
    gitOutput(repoPath, ["diff", "HEAD", "--", filePath]),
  ]);

  const rawDiff =
    tracked.trim().length > 0
      ? tracked
      : await gitOutput(repoPath, [
          "diff",
          "--no-index",
          "--",
          "/dev/null",
          filePath,
        ]);

  return {
    oldFileName: oldContent ? filePath : null,
    newFileName: newContent ? filePath : null,
    oldContent,
    newContent,
    hunks: rawDiff ? [rawDiff] : [],
  };
}
