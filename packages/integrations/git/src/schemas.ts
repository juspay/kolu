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
  /** Commits on the current branch that are ahead of its upstream
   *  (`@{u}..HEAD`). 0 when there is no upstream, a detached HEAD, or the
   *  count can't be computed — never throws. Refreshed on HEAD movement
   *  (commit / checkout / reset, via the HEAD and reflog watchers) but NOT
   *  on `git push` — push only moves the remote-tracking ref, which this
   *  watcher set does not observe, so the value can lag a push until the
   *  next HEAD event. Snapshot-at-dialog-open consumers tolerate this, and
   *  the stale direction is safe (it errs toward keeping the worktree).
   *
   *  `.default(0)` is load-bearing for migration safety: `GitInfoSchema` is
   *  embedded in the persisted + streamed `SavedSessionSchema`, so a session
   *  saved before this field existed must still validate on reload — otherwise
   *  `session.get`'s output validation throws `EVENT_ITERATOR_VALIDATION_FAILED`
   *  on every reconnect and the whole saved-session subscription dies. The
   *  watchers overwrite the 0 with the real count on the next HEAD event. */
  unpushedCommitCount: z.number().default(0),
});

// --- Git worktree operations ---

/** Worktree branch name. Catches the common ref-name violations so the
 *  toast says what's actually wrong instead of git's opaque "fatal: not
 *  a valid branch name". Obscure cases (`@{`, `.lock` suffix, leading
 *  slash) still fall through to git's own check. Exported so the client
 *  can run the same predicate live in the worktree-naming palette leaf
 *  — single source of truth for the rule. */
export const WorktreeNameSchema = z
  .string()
  .min(1)
  .refine((s) => !/[\s~^:?*[\\]/.test(s) && !s.includes(".."), {
    message:
      "branch name cannot contain whitespace, '..', or any of: ~ ^ : ? * [ \\",
  });

export const WorktreeCreateInputSchema = z.object({
  repoPath: z.string(),
  name: WorktreeNameSchema,
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
  /** Original path before rename/copy. Only present for R/C statuses. */
  oldPath: z.string().optional(),
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
  /** Original path before rename/copy — passed from the file list so
   *  getDiff can read old content at the correct path. */
  oldPath: z.string().optional(),
});

/** Raw parts needed by the client-side diff renderer (`@pierre/diffs`'s
 *  `parsePatchFiles`). The same shape serves both modes — only the `git diff`
 *  base changes (HEAD in local mode, merge-base with origin/<default> in
 *  branch mode).
 *
 *  `oldFileName` / `newFileName` are null when the file doesn't exist on
 *  that side of the diff (added file → oldFileName null; deleted file →
 *  newFileName null). The renderer uses the pair to spot pure renames
 *  (no hunks but both names set and different).
 *
 *  Classification flags (`binary`, …) gate the client to a placeholder
 *  instead of the renderer. Detection lives in `parseRawDiffFlags`
 *  (`review.ts`) — not in the client. */
export const GitDiffOutputSchema = z.object({
  oldFileName: z.string().nullable(),
  newFileName: z.string().nullable(),
  /** Raw unified-diff strings: each entry carries its own `--- / +++ / @@`
   *  header block (i.e. passthrough of `git diff` output), not a bare hunk
   *  body. Currently always zero or one element — a single per-file patch. */
  hunks: z.array(z.string()),
  /** True when git classified the file as binary (NUL bytes in the first
   *  8KB). Binary files yield no `@@` hunks — git emits a single
   *  `Binary files a/x and b/x differ` line — so the client renders a
   *  "Binary file — not displayable" placeholder instead of an empty pane. */
  binary: z.boolean(),
});
export type GitDiffOutput = z.infer<typeof GitDiffOutputSchema>;

// --- File tree browsing ---

export const FsListAllInputSchema = z.object({
  /** Absolute path to the repo root. */
  repoPath: z.string(),
});

export const FsListAllOutputSchema = z.object({
  /** Flat list of all repo-relative file paths (tracked + untracked, respecting .gitignore). */
  paths: z.array(z.string()),
});
export type FsListAllOutput = z.infer<typeof FsListAllOutputSchema>;

export const FsReadFileInputSchema = z.object({
  /** Terminal that owns the URL handle for `kind: "binary"` outputs.
   *  Text reads ignore this — the field is on the input because the URL
   *  shape (`/api/terminals/<id>/file/...`) is constructed server-side
   *  from this id, so the client doesn't have to know the route layout. */
  terminalId: z.string().uuid(),
  /** Absolute path to the repo root. */
  repoPath: z.string(),
  /** Path relative to repo root. */
  filePath: z.string(),
});

/** Discriminated by `kind`. Text files yield their content; binary-
 *  previewable files yield a cache-busted URL the client points an
 *  `<iframe>` (documents) or `<img>` (raster images) at. The variant-picker
 *  (`isBinaryPreviewable`) lives in `./previewable.ts`; the URL builder
 *  lives server-side in `iframePreviewRoute.ts`. */
export const FsReadFileOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    content: z.string(),
    /** True if the file exceeded the size limit and was truncated. */
    truncated: z.boolean(),
  }),
  z.object({
    kind: z.literal("binary"),
    /** Server-constructed URL for the iframe `src`. Includes a `?v=<mtime>`
     *  query so the stream re-yield on file change produces a new URL and
     *  the iframe reloads via the same subscription path. */
    url: z.string(),
  }),
]);
export type FsReadFileOutput = z.infer<typeof FsReadFileOutputSchema>;

// --- Derived types ---

export type GitInfo = z.infer<typeof GitInfoSchema>;
