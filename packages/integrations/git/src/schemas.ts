/** Git-domain Effect schemas — single source of truth for git types.
 *  Consumed by kolu-common (re-exported) and kolu-git functions. */

import { Schema } from "effect";

// --- Git context ---

export const GitInfoSchema = Schema.Struct({
  repoRoot: Schema.String,
  repoName: Schema.String,
  worktreePath: Schema.String,
  branch: Schema.String,
  isWorktree: Schema.Boolean,
  mainRepoRoot: Schema.String,
  /** The `origin` remote URL with credentials stripped, or null when the
   *  repo has no `origin`. Best-effort (a remote-less repo is normal). Carried
   *  so a forge dispatcher downstream can pick the PR adapter from the host;
   *  `NullOr` not `optionalKey` so every producer states it explicitly. */
  remoteUrl: Schema.NullOr(Schema.String),
});

// --- Git worktree operations ---

/** The worktree-name rule as a bare predicate. Catches the common ref-name
 *  violations so the toast says what's actually wrong instead of git's opaque
 *  "fatal: not a valid branch name". Obscure cases (`@{`, `.lock` suffix,
 *  leading slash) still fall through to git's own check. Exported so the client
 *  can run the same predicate live in the worktree-naming palette leaf — single
 *  source of truth for the rule, shared by `WorktreeNameSchema`'s check. */
export function isValidWorktreeName(name: string): boolean {
  return !/[\s~^:?*[\\]/.test(name) && !name.includes("..");
}

/** The user-visible message for a name that fails `isValidWorktreeName`.
 *  Rendered verbatim in the worktree-naming palette leaf, so it is exported
 *  alongside the predicate rather than only reachable through a decode error. */
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

// --- Local diff review ---

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
   *
   *  `optional`, not `optionalKey`: the zod original was `z.string().optional()`,
   *  which accepted the key present-but-`undefined` as well as absent. Callers
   *  read this off a file record and hand it straight to `GitDiffInputSchema`
   *  (`hostCodeTab.ts`), so `undefined` reaches the wire on every non-rename
   *  file. `optional` encodes both cases to the same bytes — the key is omitted,
   *  never nulled. */
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
 *  that upstream. A working-tree concept (HEAD vs its upstream), so `getStatus`
 *  returns it only in `local` mode and `null` in `branch` mode (where the
 *  comparison is HEAD-vs-merge-base, not HEAD-vs-upstream). `name` is never
 *  null — git's own `## <name>` porcelain header always names something, even
 *  the literal `"HEAD"` on a detached checkout — so only `upstream` is
 *  independently nullable; a detached HEAD can never carry an upstream
 *  (tracking config lives on a named branch, which a detached HEAD doesn't
 *  have), and `ahead`/`behind` are 0 whenever there is no upstream to track. */
export const GitBranchStatusSchema = Schema.Struct({
  name: Schema.String,
  upstream: Schema.NullOr(Schema.String),
  ahead: NonNegativeInt,
  behind: NonNegativeInt,
});
export type GitBranchStatus = typeof GitBranchStatusSchema.Type;

/** The three `git status` working-tree buckets, as counts. Deliberately NOT a
 *  derivation of `files[]`: that list collapses each file to ONE code
 *  (working-tree column with index fallback), so staging a modified file
 *  (`git add`) moves it from `modified` to `staged` WITHOUT changing its
 *  collapsed code. These counts therefore carry information `files[]` cannot
 *  reconstruct — which is exactly why they participate in `gitStatusOutputEqual`
 *  (so a `git add` re-yields the watcher stream). `local` mode only; `null` in
 *  `branch` mode. */
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

/** `getStatus`'s result, a discriminated union on `mode` so each variant carries
 *  exactly the fields that apply — the illegal combinations a per-field-nullable
 *  shape permitted (a local result with a null branch, a branch result with a
 *  populated working tree) are now unrepresentable. The discriminator IS the key
 *  the caller already passes in:
 *
 *  - `local` (working tree vs HEAD): always carries the branch-tracking header
 *    (current branch + ahead/behind vs upstream) and the working-tree section
 *    counts. Both added in terminal-workspace contract 0.4 — pulam's fleet board
 *    reads them on each `subscribeRepoChange` pulse to paint a row's live
 *    ahead/behind and the drill-in summary (R4.7), computed from the same `git
 *    status` the file list already reads (no extra git call).
 *  - `branch` (working tree vs `merge-base(origin/<default>)`): carries the
 *    resolved base ref, or `null` when the repo has no base to compare against (a
 *    remote-less repo with no `origin`, #1244 — branch mode degrades to an empty
 *    diff there rather than erroring). The HEAD-vs-upstream tracking and the
 *    working-tree counts don't apply here, so they're absent, not nulled. */
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

/** The `local`-mode arm of `GitStatusOutput` — the working-tree-vs-HEAD result,
 *  with the branch-tracking header and the working-tree section counts both
 *  guaranteed present (a consumer that only ever requests `mode: "local"`, like
 *  pulam's fleet board, narrows to this so it reads `branch`/`workingTree`
 *  without a per-read null guard). */
export type LocalGitStatus = Extract<GitStatusOutput, { mode: "local" }>;

export const GitDiffInputSchema = Schema.Struct({
  repoPath: Schema.String,
  /** Path relative to the repo root. */
  filePath: Schema.String,
  mode: GitDiffModeSchema,
  /** Original path before rename/copy — passed from the file list so
   *  getDiff can read old content at the correct path. `optional` for the same
   *  reason as `GitChangedFileSchema.oldPath`: the caller forwards a plain
   *  `file.oldPath`, which is `undefined` for every file that is not a
   *  rename/copy. */
  oldPath: Schema.optional(Schema.String),
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
export const GitDiffOutputSchema = Schema.Struct({
  oldFileName: Schema.NullOr(Schema.String),
  newFileName: Schema.NullOr(Schema.String),
  /** Raw unified-diff strings: each entry carries its own `--- / +++ / @@`
   *  header block (i.e. passthrough of `git diff` output), not a bare hunk
   *  body. Currently always zero or one element — a single per-file patch. */
  hunks: Schema.Array(Schema.String),
  /** True when git classified the file as binary (NUL bytes in the first
   *  8KB). Binary files yield no `@@` hunks — git emits a single
   *  `Binary files a/x and b/x differ` line — so the client renders a
   *  "Binary file — not displayable" placeholder instead of an empty pane. */
  binary: Schema.Boolean,
});
export type GitDiffOutput = typeof GitDiffOutputSchema.Type;

// --- File tree browsing ---

export const FsListAllInputSchema = Schema.Struct({
  /** Absolute path to the repo root. */
  repoPath: Schema.String,
});

export const FsListAllOutputSchema = Schema.Struct({
  /** Flat list of all repo-relative file paths (tracked + untracked, respecting .gitignore). */
  paths: Schema.Array(Schema.String),
});
export type FsListAllOutput = typeof FsListAllOutputSchema.Type;

/** The gitignored listing is its OWN procedure rather than a flag on
 *  `fs.listAll`, so the two are independently queryable. That separation is
 *  load-bearing on the client: the Code tab's show-ignored toggle keys only
 *  THIS query, leaving the main file-list query (and therefore the mounted
 *  tree, its hand-expanded folders, and its scroll position) untouched when the
 *  toggle flips. Folding it into `fs.listAll` as an `includeIgnored` flag put
 *  the toggle in that query's value key, which blanked the whole list and
 *  remounted the tree collapsed on every flip. */
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

/** The on-demand counterpart to `listIgnored`'s collapse. A collapsed directory
 *  is the one place the flat listings deliberately stop, so the tree has no
 *  child to paint when the user opens that row; this reads the level then. Kept
 *  a separate procedure for the same reason `listIgnored` is: it is keyed by
 *  DIRECTORY and fired by a click, so folding it into either whole-repo listing
 *  would put a per-expansion input in that query's value key and blank the
 *  tree on every click. */
export const FsListDirectoryInputSchema = Schema.Struct({
  /** Absolute path to the browse ROOT. Historically a git repo root (the name
   *  stays for wire compatibility), but since plain-directory browsing (5.3's
   *  `subscribeDirChange`, which shares this input) it may be ANY absolute
   *  directory — this read and its watch counterpart never consult git. */
  repoPath: Schema.String,
  /** Directory to read, relative to the root (`""` for the root itself).
   *  Pierre's folder key carries a trailing slash; both spellings resolve to
   *  the same listing. */
  dirPath: Schema.String,
});

export const FsListDirectoryOutputSchema = Schema.Struct({
  /** ONE level of repo-relative entries, subdirectories carrying git's trailing
   *  slash so they render collapsed and expandable in their own turn. */
  paths: Schema.Array(Schema.String),
});
export type FsListDirectoryOutput = typeof FsListDirectoryOutputSchema.Type;

export const FsReadFileInputSchema = Schema.Struct({
  /** Terminal that owns the URL handle for `kind: "binary"` outputs.
   *  Text reads ignore this — the field is on the input because the URL
   *  shape (`/api/terminals/<host>/<id>/file/...`) is constructed server-side
   *  from this id, so the client doesn't have to know the route layout. */
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
export const FsReadFileOutputSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("text"),
    content: Schema.String,
    /** True if the file exceeded the size limit and was truncated. */
    truncated: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("binary"),
    /** Server-constructed URL for the iframe `src`. Includes a
     *  `?v=<tag>` query so the stream re-yield on a real content change
     *  produces a new URL and the iframe reloads via the same subscription path
     *  — while an identical-content rewrite leaves the URL (and the preview)
     *  stable. */
    url: Schema.String,
  }),
]);
export type FsReadFileOutput = typeof FsReadFileOutputSchema.Type;

// --- Derived types ---

export type GitInfo = typeof GitInfoSchema.Type;
