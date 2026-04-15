/**
 * Diff review — powers the "Code Diff" right-panel tab (issue #514).
 *
 * Two operations, each parameterized by a `mode`:
 *   - `getStatus(repoPath, mode)` → files changed for that mode.
 *   - `getDiff(repoPath, filePath, mode)` → old/new content + the raw
 *     unified diff string, pre-shaped for `@git-diff-view/solid`'s
 *     `DiffView` data prop.
 *
 * Modes:
 *   - `local` (phase 1): working tree vs `HEAD`. Includes untracked files.
 *   - `branch` (phase 2): working tree vs `merge-base(HEAD, origin/<default>)` —
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
import { ORPCError } from "@orpc/server";
import { simpleGit } from "simple-git";
import {
  GitChangeStatusSchema,
  type GitBaseRef,
  type GitChangedFile,
  type GitChangeStatus,
  type GitDiffMode,
  type GitDiffOutput,
  type GitStatusOutput,
} from "kolu-common";
import { detectDefaultBranch } from "./git.ts";
import { log } from "./log.ts";
import { resolveUnder } from "./safe-path.ts";

const execFileP = promisify(execFile);

/** Coerce a raw porcelain / name-status letter into the typed enum,
 *  falling back to "?" for anything unexpected. */
function toChangeStatus(letter: string): GitChangeStatus {
  const parsed = GitChangeStatusSchema.safeParse(letter);
  return parsed.success ? parsed.data : "?";
}

/**
 * Resolve the base ref for branch mode: `origin/<defaultBranch>` and the
 * merge-base SHA between it and HEAD. Throws with an actionable message
 * when `origin/<defaultBranch>` doesn't exist — users can't review "what
 * this branch adds vs the base" if there is no base to diff against.
 */
async function resolveBase(repoPath: string): Promise<GitBaseRef> {
  const defaultBranch = await detectDefaultBranch(repoPath);
  const ref = `origin/${defaultBranch}`;
  const git = simpleGit(repoPath);
  try {
    await git.raw(["rev-parse", "--verify", `${ref}^{commit}`]);
  } catch {
    // `rev-parse --verify` is a read-only name lookup — the realistic
    // failure mode is "ref doesn't exist". Translate that to an actionable
    // error rather than surfacing simple-git's `fatal: Needed a single
    // revision` string to the reviewer.
    //
    // Uses `ORPCError` (not plain `Error`) so the message survives to the
    // client — oRPC sanitizes unknown `Error` throws to "Internal Server
    // Error" by default, which would hide the actionable suggestion below.
    throw new ORPCError("PRECONDITION_FAILED", {
      message:
        `No base branch found — ${ref} doesn't exist. ` +
        `Run: git fetch origin && git remote set-head origin --auto`,
    });
  }
  const sha = (await git.raw(["merge-base", "HEAD", ref])).trim();
  return { ref, sha };
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
    const filePath = parts.length >= 3 ? parts[2] : parts[1];
    if (!filePath) continue;
    files.push({ path: filePath, status: toChangeStatus(letter) });
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
    seen.set(f.path, { path: f.path, status: toChangeStatus(letter) });
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
): Promise<GitStatusOutput> {
  if (mode === "local") {
    return { files: await getLocalStatus(repoPath), base: null };
  }
  const base = await resolveBase(repoPath);
  const raw = await gitOutput(repoPath, ["diff", "--name-status", base.sha]);
  return { files: parseNameStatus(raw), base };
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
  } catch (err) {
    // Narrow to the one expected failure: simple-git wraps the fatal
    // line, which for a missing path reads either
    //   "fatal: path '<p>' does not exist in '<rev>'"
    // or
    //   "fatal: Path '<p>' exists on disk, but not in '<rev>'"
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
): Promise<GitDiffOutput> {
  const { abs, rel } = resolveUnder(repoPath, filePath);

  const baseRev = mode === "local" ? "HEAD" : (await resolveBase(repoPath)).sha;

  const [oldContent, newContent, tracked] = await Promise.all([
    readContentAtRev(repoPath, baseRev, rel),
    readWorkingContent(abs),
    gitOutput(repoPath, ["diff", baseRev, "--", rel]),
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
          // Use the pre-validated absolute path — `--no-index`'s behavior
          // w.r.t. cwd is less universally stable than `git diff HEAD --`,
          // and `abs` already went through `resolveUnder`.
          abs,
        ])
      : tracked;

  if (!rawDiff.trim().length) {
    // Both `git diff <base> --` and `--no-index` produced nothing for a
    // file the client asked about. Legitimate cases (mode-only change
    // that's already been reset, race with an external `git reset`) are
    // possible but rare — log so operators can spot a pattern.
    log.warn(
      { filePath: rel, mode },
      "git-review: empty diff for requested file",
    );
  }

  return {
    oldFileName: oldContent ? rel : null,
    newFileName: newContent ? rel : null,
    oldContent,
    newContent,
    hunks: rawDiff ? [rawDiff] : [],
  };
}
