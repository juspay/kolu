/**
 * Diff review — powers the "Code Diff" right-panel tab.
 *
 * Two operations, each parameterized by a `mode`:
 *   - `getStatus(repoPath, mode)` → files changed for that mode.
 *   - `getDiff(repoPath, filePath, mode)` → old/new content + the raw
 *     unified diff string, pre-shaped for `@git-diff-view/solid`'s
 *     `DiffView` data prop.
 *
 * Modes:
 *   - `local`: working tree vs `HEAD`. Includes untracked files.
 *   - `branch`: working tree vs `merge-base(HEAD, origin/<default>)` —
 *     same answer a PR's "Files changed" tab gives, computed locally and
 *     forge-agnostically. Untracked files are excluded (they can't ship).
 *
 * The diff itself is produced by `git diff` — we just pipe its output
 * through. Untracked files in local mode go through `git diff --no-index`,
 * which exits 1 by design when files differ; we capture stdout regardless.
 */

import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { simpleGit } from "simple-git";
import type { Logger } from "anyagent";
import {
  GitChangeStatusSchema,
  type GitBaseRef,
  type GitChangedFile,
  type GitChangeStatus,
  type GitDiffMode,
  type GitDiffOutput,
  type GitStatusOutput,
} from "./schemas.ts";
import { detectDefaultBranch } from "./worktree.ts";
import { resolveUnder } from "./safe-path.ts";
import { type GitResult, ok, err } from "./errors.ts";

const execFileP = promisify(execFile);

/** Coerce a raw porcelain / name-status letter into the typed enum,
 *  falling back to "?" for anything unexpected. */
function toChangeStatus(letter: string): GitChangeStatus {
  const parsed = GitChangeStatusSchema.safeParse(letter);
  return parsed.success ? parsed.data : "?";
}

/**
 * Resolve the base ref for branch mode: `origin/<defaultBranch>` and the
 * merge-base SHA between it and HEAD.
 */
async function resolveBase(repoPath: string): Promise<GitResult<GitBaseRef>> {
  const defaultBranch = await detectDefaultBranch(repoPath);
  const ref = `origin/${defaultBranch}`;
  const git = simpleGit(repoPath);
  try {
    await git.raw(["rev-parse", "--verify", `${ref}^{commit}`]);
  } catch {
    return err({
      code: "BASE_BRANCH_NOT_FOUND",
      ref,
      message:
        `No base branch found — ${ref} doesn't exist. ` +
        `Run: git fetch origin && git remote set-head origin --auto`,
    });
  }
  const sha = (await git.raw(["merge-base", "HEAD", ref])).trim();
  return ok({ ref, sha });
}

/**
 * Parse `git diff --name-status <rev>` output into changed files.
 *
 * Format: one file per line, TAB-separated. Most rows are
 *   `<letter>\t<path>`; renames and copies insert a similarity score
 *   after the letter and carry two paths: `R100\told\tnew`, `C75\tsrc\tdst`.
 *   For those, the *new* path is the one under review.
 */
export function parseNameStatus(raw: string): GitChangedFile[] {
  const files: GitChangedFile[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    const letter = parts[0]?.[0] ?? "";
    // Rename/copy rows have 3 fields; everything else has 2.
    const isRenameOrCopy = parts.length >= 3;
    const filePath = isRenameOrCopy ? parts[2] : parts[1];
    if (!filePath) continue;
    const status = toChangeStatus(letter);
    const oldPath = isRenameOrCopy ? parts[1] : undefined;
    files.push({ path: filePath, status, ...(oldPath && { oldPath }) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Working-tree status vs HEAD — the local-mode file list. Returns one
 * entry per modified, added, deleted, renamed, copied, conflicted, or
 * untracked file. Ignored files are excluded.
 */
async function getLocalStatus(repoPath: string): Promise<GitChangedFile[]> {
  const git = simpleGit(repoPath);
  const status = await git.status();

  // `files` covers tracked changes; `not_added` covers untracked paths.
  // Deduplicate via `path` — status rows may overlap with not_added for
  // intent-to-add paths.
  const seen = new Map<string, GitChangedFile>();
  for (const f of status.files) {
    // working_dir takes precedence; fall back to index.
    const letter = f.working_dir !== " " ? f.working_dir : f.index;
    seen.set(f.path, {
      path: f.path,
      status: toChangeStatus(letter),
      ...(f.from && { oldPath: f.from }),
    });
  }
  for (const p of status.not_added) {
    if (!seen.has(p)) seen.set(p, { path: p, status: "?" });
  }

  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * File list for `mode`. In `branch` mode the list comes from
 * `git diff --name-status <merge-base>` — which naturally excludes
 * untracked files (they aren't in any tree git compares against).
 */
export async function getStatus(
  repoPath: string,
  mode: GitDiffMode,
  log?: Logger,
): Promise<GitResult<GitStatusOutput>> {
  try {
    if (mode === "local") {
      return ok({ files: await getLocalStatus(repoPath), base: null });
    }
    const baseResult = await resolveBase(repoPath);
    if (!baseResult.ok) return baseResult;
    const raw = await gitOutput(repoPath, [
      "diff",
      "--name-status",
      baseResult.value.sha,
    ]);
    return ok({ files: parseNameStatus(raw), base: baseResult.value });
  } catch (e) {
    log?.error(
      { err: e instanceof Error ? e.message : String(e), repoPath, mode },
      "git-review: getStatus failed",
    );
    return err({
      code: "GIT_FAILED",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Read the contents of `relPath` at the given git revision. Returns
 * empty string when the path is absent from `rev` (newly added on this
 * side of the diff); any other git failure (missing rev, permission
 * denied, corrupted object) propagates.
 */
async function readContentAtRev(
  repoPath: string,
  rev: string,
  relPath: string,
): Promise<string> {
  const git = simpleGit(repoPath);
  try {
    return await git.show([`${rev}:${relPath}`]);
  } catch (e) {
    // Narrow to the one expected failure: simple-git wraps the fatal
    // line, which for a missing path reads either
    //   "fatal: path '<p>' does not exist in '<rev>'"
    // or
    //   "fatal: Path '<p>' exists on disk, but not in '<rev>'"
    const msg = e instanceof Error ? e.message : "";
    if (/does not exist in |exists on disk, but not in /.test(msg)) return "";
    throw e;
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
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
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
  } catch (e) {
    // `execFile`'s rejection carries `code` (exit status, number) and
    // `stdout`/`stderr` on the error object. NodeJS.ErrnoException types
    // `code` as `string`, which doesn't match — cast through the shape
    // we actually observe.
    const ex = e as { code?: number; stdout?: string };
    if (ex.code === 1 && typeof ex.stdout === "string") return ex.stdout;
    throw e;
  }
}

/**
 * Compute the unified diff of one file for the given mode, pre-shaped
 * for `@git-diff-view/solid`'s `DiffView` data prop.
 *
 * Local mode: `git diff HEAD -- <file>` for tracked changes; falls back
 * to `git diff --no-index /dev/null <file>` for untracked files.
 * Branch mode: `git diff <merge-base> -- <file>`. No `--no-index`
 * fallback — branch-mode files come from `git diff --name-status`, so
 * `git diff <merge-base> -- <file>` is guaranteed to produce output.
 */
export async function getDiff(
  repoPath: string,
  filePath: string,
  mode: GitDiffMode,
  log?: Logger,
  oldPath?: string,
): Promise<GitResult<GitDiffOutput>> {
  const pathResult = resolveUnder(repoPath, filePath, log);
  if (!pathResult.ok) return pathResult;
  const { abs, rel } = pathResult.value;

  // Validate oldPath the same way filePath is validated — it comes from
  // the client and must not escape the repo root.
  let oldRel = rel;
  if (oldPath) {
    const oldPathResult = resolveUnder(repoPath, oldPath, log);
    if (!oldPathResult.ok) return oldPathResult;
    oldRel = oldPathResult.value.rel;
  }

  let baseRev: string;
  if (mode === "local") {
    baseRev = "HEAD";
  } else {
    const baseResult = await resolveBase(repoPath);
    if (!baseResult.ok) return baseResult;
    baseRev = baseResult.value.sha;
  }

  try {
    const [oldContent, newContent, tracked] = await Promise.all([
      readContentAtRev(repoPath, baseRev, oldRel),
      readWorkingContent(abs),
      oldPath
        ? gitOutput(repoPath, ["diff", "-M", baseRev, "--", oldRel, rel])
        : gitOutput(repoPath, ["diff", baseRev, "--", rel]),
    ]);

    // Branch mode's file list comes from `git diff --name-status`, which
    // only surfaces files already in the diff — so `git diff <base> -- <f>`
    // is guaranteed to produce output and never needs `--no-index`. Local
    // mode, on the other hand, also surfaces untracked files (via
    // `git.status().not_added`); those yield empty output from the normal
    // `git diff HEAD --` path, so we synthesize a diff against `/dev/null`.
    const rawDiff =
      mode === "local" && tracked.trim().length === 0
        ? await gitOutput(repoPath, [
            "diff",
            "--no-index",
            "--",
            "/dev/null",
            abs,
          ])
        : tracked;

    if (!rawDiff.trim().length) {
      log?.warn(
        { filePath: rel, mode },
        "git-review: empty diff for requested file",
      );
    }

    return ok({
      oldFileName: oldContent ? oldRel : null,
      newFileName: newContent ? rel : null,
      oldContent,
      newContent,
      hunks: rawDiff ? [rawDiff] : [],
    });
  } catch (e) {
    return err({
      code: "GIT_FAILED",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
