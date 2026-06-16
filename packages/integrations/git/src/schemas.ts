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
  /** The `origin` remote URL with credentials stripped, or null when the
   *  repo has no `origin`. Best-effort (a remote-less repo is normal). Carried
   *  so a forge dispatcher downstream can pick the PR adapter from the host;
   *  `.nullable()` not `.optional()` so every producer states it explicitly. */
  remoteUrl: z.string().nullable(),
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
  /** Host whose endpoint serves this repo (P3, kaval-sessions). Absent ⇒
   *  local. The server resolves the owning `TerminalEndpoint` from it, so
   *  a remote terminal's Code tab reads fs/git over the ssh link instead
   *  of this machine. Omitted by pre-P3 clients ⇒ local ⇒ unchanged. */
  hostId: z.string().optional(),
});

export const GitStatusOutputSchema = z.object({
  files: z.array(GitChangedFileSchema),
  /** Null in local mode. In branch mode it's the resolved base ref, or
   *  null when the repo has no base to compare against (a remote-less repo
   *  with no `origin`, #1244) — branch mode degrades to an empty diff there
   *  rather than erroring. */
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
  /** Host whose endpoint serves this repo (P3). Absent ⇒ local. */
  hostId: z.string().optional(),
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
  /** Host whose endpoint serves this repo (P3). Absent ⇒ local. */
  hostId: z.string().optional(),
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
  /** Host whose endpoint serves this repo (P3). Absent ⇒ local. */
  hostId: z.string().optional(),
});

/** Discriminated by `kind`. Text files yield their content; binary-
 *  previewable files yield a cache-busted URL the client points an
 *  `<iframe>` (documents) or `<img>` (raster images) at. The variant-picker
 *  (`isBinaryPreviewable`) lives in the node-free `kolu-common/preview`
 *  classifier; the URL builder lives server-side in `iframePreviewRoute.ts`. */
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
