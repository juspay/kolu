import { Effect, Schema } from "effect";

export const GitInfoSchema = Schema.Struct({
  repoRoot: Schema.String,
  repoName: Schema.String,
  worktreePath: Schema.String,
  branch: Schema.String,
  isWorktree: Schema.Boolean,
  mainRepoRoot: Schema.String,
  /** The `origin` remote URL with credentials stripped, or null when the
   *  repo has no `origin`. */
  remoteUrl: Schema.NullOr(Schema.String),
  /** True when the repo has no working tree at `repoRoot` (a bare repo, or a
   *  folder holding a bare `.git`), so git cannot list files there. The
   *  decoding default lets a terminal saved before this field load; encoding
   *  never omits it. */
  isBare: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false)),
  ),
});

/** The worktree-name rule as a bare predicate. Catches the common ref-name
 *  violations; obscure cases (`@{`, `.lock` suffix, leading slash) still fall
 *  through to git's own check. */
export function isValidWorktreeName(name: string): boolean {
  return !/[\s~^:?*[\\]/.test(name) && !name.includes("..");
}

/** The user-visible message for a name that fails `isValidWorktreeName`. */
export const WORKTREE_NAME_MESSAGE =
  "branch name cannot contain whitespace, '..', or any of: ~ ^ : ? * [ \\";

/** Worktree branch name: non-empty and free of the characters git rejects. */
export const WorktreeNameSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((s: string) =>
    isValidWorktreeName(s) ? undefined : WORKTREE_NAME_MESSAGE,
  ),
);

export const WorktreeCreateInputSchema = Schema.Struct({
  repoPath: Schema.String,
  name: WorktreeNameSchema,
});

export const WorktreeCreateOutputSchema = Schema.Struct({
  path: Schema.String,
  branch: Schema.String,
});

export const WorktreeRemoveInputSchema = Schema.Struct({
  worktreePath: Schema.String,
});

/** Single-letter git porcelain status code, narrowed to what `git.status`
 *  actually surfaces to the Code Diff tab. Excludes " " (unmodified) and
 *  "!" (ignored) — neither is included in the changed-files list. */
export const GitChangeStatusSchema = Schema.Literals([
  "M", // modified
  "A", // added
  "D", // deleted
  "R", // renamed
  "C", // copied
  "U", // unmerged (conflict)
  "T", // type changed (e.g. file → symlink)
  "?", // untracked
]);
export type GitChangeStatus = typeof GitChangeStatusSchema.Type;

export const GitChangedFileSchema = Schema.Struct({
  /** Path relative to repo root. */
  path: Schema.String,
  status: GitChangeStatusSchema,
  /** Original path before rename/copy. Only present for R/C statuses.
   *  `optional`, not `optionalKey`: callers hand a plain `file.oldPath` to
   *  `GitDiffInputSchema`, so present-but-`undefined` reaches the wire and must
   *  encode to the same bytes as an absent key. */
  oldPath: Schema.optional(Schema.String),
});
export type GitChangedFile = typeof GitChangedFileSchema.Type;

/** Which base the Code Diff tab is diffing against.
 *  - `local`: working tree vs `HEAD` — "what hasn't been committed yet".
 *  - `branch`: working tree vs `merge-base(HEAD, origin/<defaultBranch>)` —
 *    "what this branch will ship". Same computation as a PR "Files changed"
 *    tab; done locally, forge-agnostic. */
export const GitDiffModeSchema = Schema.Literals(["local", "branch"]);
export type GitDiffMode = typeof GitDiffModeSchema.Type;

/** Resolved base ref for branch mode — echoed back so the UI can label
 *  the panel ("Changes vs origin/master") without re-resolving. */
export const GitBaseRefSchema = Schema.Struct({
  /** Human-readable ref name, e.g. `origin/master`. */
  ref: Schema.String,
  /** Actual merge-base commit SHA (what `git diff` was run against). */
  sha: Schema.String,
});
export type GitBaseRef = typeof GitBaseRefSchema.Type;

/** A count of files — a non-negative integer. */
const NonNegativeInt = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
);

/** Branch-tracking state — the `git status -b` header: the current branch, its
 *  upstream (null when none is configured), and how far HEAD is ahead/behind
 *  that upstream. `getStatus` returns it only in `local` mode. `name` is never
 *  null: git's `## <name>` header always names something, even the literal
 *  `"HEAD"` on a detached checkout. */
export const GitBranchStatusSchema = Schema.Struct({
  name: Schema.String,
  upstream: Schema.NullOr(Schema.String),
  ahead: NonNegativeInt,
  behind: NonNegativeInt,
});
export type GitBranchStatus = typeof GitBranchStatusSchema.Type;

/** The three `git status` working-tree buckets, as counts. NOT derivable from
 *  `files[]`, which collapses each file to ONE code: `git add` moves a file
 *  from `modified` to `staged` without changing that code. `local` mode only;
 *  `null` in `branch` mode. */
export const GitWorkingTreeSummarySchema = Schema.Struct({
  /** Files with a staged (index-vs-HEAD) change. */
  staged: NonNegativeInt,
  /** Files with an unstaged (working-tree-vs-index) change. */
  modified: NonNegativeInt,
  /** Untracked, non-ignored files. */
  untracked: NonNegativeInt,
});
export type GitWorkingTreeSummary = typeof GitWorkingTreeSummarySchema.Type;

export const GitStatusInputSchema = Schema.Struct({
  repoPath: Schema.String,
  mode: GitDiffModeSchema,
});

/** `getStatus`'s result, a discriminated union on `mode` so each variant
 *  carries exactly the fields that apply.
 *
 *  - `local` (working tree vs HEAD): always carries the branch-tracking header
 *    and the working-tree section counts.
 *  - `branch` (working tree vs `merge-base(origin/<default>)`): carries the
 *    resolved base ref, or `null` when the repo has no base to compare against
 *    (a remote-less repo with no `origin`, #1244). */
export const GitStatusOutputSchema = Schema.Union([
  Schema.Struct({
    mode: Schema.Literal("local"),
    files: Schema.Array(GitChangedFileSchema),
    branch: GitBranchStatusSchema,
    workingTree: GitWorkingTreeSummarySchema,
  }),
  Schema.Struct({
    mode: Schema.Literal("branch"),
    files: Schema.Array(GitChangedFileSchema),
    base: Schema.NullOr(GitBaseRefSchema),
  }),
]);
export type GitStatusOutput = typeof GitStatusOutputSchema.Type;

/** The `local`-mode arm of `GitStatusOutput`, with the branch-tracking header
 *  and the working-tree section counts both guaranteed present. */
export type LocalGitStatus = Extract<GitStatusOutput, { mode: "local" }>;

export const GitDiffInputSchema = Schema.Struct({
  repoPath: Schema.String,
  /** Path relative to the repo root. */
  filePath: Schema.String,
  mode: GitDiffModeSchema,
  /** Original path before rename/copy — passed from the file list so
   *  getDiff can read old content at the correct path. */
  oldPath: Schema.optional(Schema.String),
});

/** Raw parts needed by the client-side diff renderer (`@pierre/diffs`'s
 *  `parsePatchFiles`). `oldFileName` / `newFileName` are null when the file
 *  doesn't exist on that side of the diff; the renderer uses the pair to spot
 *  pure renames. */
export const GitDiffOutputSchema = Schema.Struct({
  oldFileName: Schema.NullOr(Schema.String),
  newFileName: Schema.NullOr(Schema.String),
  /** Raw unified-diff strings: each entry carries its own `--- / +++ / @@`
   *  header block (i.e. passthrough of `git diff` output), not a bare hunk
   *  body. Currently always zero or one element — a single per-file patch. */
  hunks: Schema.Array(Schema.String),
  /** True when git classified the file as binary. Binary files yield no `@@`
   *  hunks — git emits a single `Binary files a/x and b/x differ` line. */
  binary: Schema.Boolean,
});
export type GitDiffOutput = typeof GitDiffOutputSchema.Type;

export const FsListAllInputSchema = Schema.Struct({
  /** Absolute path to the repo root. */
  repoPath: Schema.String,
});

export const FsListAllOutputSchema = Schema.Struct({
  /** Flat list of all repo-relative file paths (tracked + untracked, respecting .gitignore). */
  paths: Schema.Array(Schema.String),
});
export type FsListAllOutput = typeof FsListAllOutputSchema.Type;

/** Its OWN procedure rather than a flag on `fs.listAll`, so the Code tab's
 *  show-ignored toggle keys only THIS query and leaves the mounted tree, its
 *  hand-expanded folders and its scroll position untouched when it flips. */
export const FsListIgnoredInputSchema = Schema.Struct({
  /** Absolute path to the repo root. */
  repoPath: Schema.String,
});

export const FsListIgnoredOutputSchema = Schema.Struct({
  /** Gitignored entries, COLLAPSED: a fully-ignored directory is ONE entry
   *  carrying a trailing slash (`node_modules/`), never its contents. */
  paths: Schema.Array(Schema.String),
});
export type FsListIgnoredOutput = typeof FsListIgnoredOutputSchema.Type;

/** The on-demand counterpart to `listIgnored`'s collapse: reads one level of a
 *  collapsed directory when the user opens that row. Keyed by DIRECTORY and
 *  fired by a click, so it stays a separate procedure. */
export const FsListDirectoryInputSchema = Schema.Struct({
  /** Absolute path to the repo root. */
  repoPath: Schema.String,
  /** Directory to read, relative to the repo root. Pierre's folder key carries
   *  a trailing slash; both spellings resolve to the same listing. */
  dirPath: Schema.String,
});

export const FsListDirectoryOutputSchema = Schema.Struct({
  /** ONE level of repo-relative entries, subdirectories carrying git's trailing
   *  slash so they render collapsed and expandable in their own turn. */
  paths: Schema.Array(Schema.String),
});
export type FsListDirectoryOutput = typeof FsListDirectoryOutputSchema.Type;

export const FsReadFileInputSchema = Schema.Struct({
  /** Terminal that owns the URL handle for `kind: "binary"` outputs. The URL
   *  shape is constructed server-side from this id. */
  terminalId: Schema.String.check(Schema.isUUID()),
  /** Absolute path to the repo root. */
  repoPath: Schema.String,
  /** Path relative to repo root. */
  filePath: Schema.String,
});

/** Discriminated by `kind`. Text files yield their content; binary-
 *  previewable files yield a cache-busted URL the client points an
 *  `<iframe>` (documents) or `<img>` (raster images) at. The variant-picker
 *  (`isBinaryPreviewable`) lives in the node-free `kolu-common/preview`
 *  classifier; the URL builder lives server-side in `iframePreviewRoute.ts`. */
/** The most of a file `fs.readFile` returns: 1 MiB. Past it the content is cut
 *  there and `truncated` set. */
export const MAX_READ_BYTES = 1_048_576;

export const FsReadFileOutputSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("text"),
    content: Schema.String,
    /** True if the file exceeded the size limit and was truncated. */
    truncated: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("binary"),
    /** Server-constructed URL for the iframe `src`, carrying a `?v=<tag>`
     *  query so a real content change produces a new URL while an
     *  identical-content rewrite leaves it stable. */
    url: Schema.String,
  }),
]);
export type FsReadFileOutput = typeof FsReadFileOutputSchema.Type;

export type GitInfo = typeof GitInfoSchema.Type;
