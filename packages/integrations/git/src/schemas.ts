/** Git-domain Zod schemas — single source of truth for git types.
 *  Consumed by kolu-common (re-exported) and kolu-git functions. */

import { z } from "zod";

// --- Git context ---

export const GitInfoSchema = z.object({
  repoRoot: z.string(),
  repoName: z.string(),
  worktreePath: z.string(),
  branch: z.string(),
  isWorktree: z.boolean(),
  mainRepoRoot: z.string(),
});

// --- Git worktree operations ---

export const WorktreeCreateInputSchema = z.object({
  repoPath: z.string(),
});

export const WorktreeCreateOutputSchema = z.object({
  path: z.string(),
  branch: z.string(),
});

export const WorktreeRemoveInputSchema = z.object({
  worktreePath: z.string(),
});

// --- Local diff review ---

/** Single-letter git porcelain status code, narrowed to what `git.status`
 *  actually surfaces to the Code Diff tab. Excludes " " (unmodified) and
 *  "!" (ignored) — neither is included in the changed-files list. */
export const GitChangeStatusSchema = z.enum([
  "M", // modified
  "A", // added
  "D", // deleted
  "R", // renamed
  "C", // copied
  "U", // unmerged (conflict)
  "T", // type changed (e.g. file → symlink)
  "?", // untracked
]);
export type GitChangeStatus = z.infer<typeof GitChangeStatusSchema>;

export const GitChangedFileSchema = z.object({
  /** Path relative to repo root. */
  path: z.string(),
  status: GitChangeStatusSchema,
});
export type GitChangedFile = z.infer<typeof GitChangedFileSchema>;

/** Which base the Code Diff tab is diffing against.
 *  - `local`: working tree vs `HEAD` — "what hasn't been committed yet".
 *  - `branch`: working tree vs `merge-base(HEAD, origin/<defaultBranch>)` —
 *    "what this branch will ship". Same computation as a PR "Files changed"
 *    tab; done locally, forge-agnostic. */
export const GitDiffModeSchema = z.enum(["local", "branch"]);
export type GitDiffMode = z.infer<typeof GitDiffModeSchema>;

/** Resolved base ref for branch mode — echoed back so the UI can label
 *  the panel ("Changes vs origin/master") without re-resolving. */
export const GitBaseRefSchema = z.object({
  /** Human-readable ref name, e.g. `origin/master`. */
  ref: z.string(),
  /** Actual merge-base commit SHA (what `git diff` was run against). */
  sha: z.string(),
});
export type GitBaseRef = z.infer<typeof GitBaseRefSchema>;

export const GitStatusInputSchema = z.object({
  repoPath: z.string(),
  mode: GitDiffModeSchema,
});

export const GitStatusOutputSchema = z.object({
  files: z.array(GitChangedFileSchema),
  /** Null in local mode; resolved base ref in branch mode. */
  base: GitBaseRefSchema.nullable(),
});
export type GitStatusOutput = z.infer<typeof GitStatusOutputSchema>;

export const GitDiffInputSchema = z.object({
  repoPath: z.string(),
  /** Path relative to the repo root. */
  filePath: z.string(),
  mode: GitDiffModeSchema,
});

/** Raw parts needed by `@git-diff-view/solid`'s `DiffView` data prop.
 *  The same shape serves both modes — only the `git diff` base changes
 *  (HEAD in local mode, merge-base with origin/<default> in branch mode). */
export const GitDiffOutputSchema = z.object({
  oldFileName: z.string().nullable(),
  newFileName: z.string().nullable(),
  oldContent: z.string(),
  newContent: z.string(),
  /** Raw unified-diff strings, shaped for `@git-diff-view/core`'s parser:
   *  each entry carries its own `--- / +++ / @@` header block (i.e.
   *  passthrough of `git diff` output), not a bare hunk body. Currently
   *  always zero or one element — a single per-file patch. */
  hunks: z.array(z.string()),
});
export type GitDiffOutput = z.infer<typeof GitDiffOutputSchema>;

// --- Derived types ---

export type GitInfo = z.infer<typeof GitInfoSchema>;
