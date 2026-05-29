/** kolu-git — pure git operations for Kolu.
 *
 *  All fallible functions return GitResult<T> instead of throwing.
 *  Functions accept an optional Logger for instrumentation. */

// Name generation
export { randomName } from "memorable-names";
// File tree browsing
export { listAll, readFile, statFileMtimeMs } from "./browse.ts";
// Equality predicates for streamed snapshot dedup
export {
  fsListAllOutputEqual,
  fsReadFileOutputEqual,
  gitDiffOutputEqual,
  gitStatusOutputEqual,
} from "./equals.ts";
// Error types
export { err, type GitError, type GitResult, ok } from "./errors.ts";
// HEAD watcher (refcounted shared singleton)
export { watchGitHead } from "./head-watcher.ts";
// Index watcher (refcounted shared singleton, axis 3)
export { watchGitIndex } from "./index-watcher.ts";
// Reflog watcher (refcounted shared singleton, axis 2)
export { watchGitReflog } from "./reflog-watcher.ts";
// Composed primitives for the live Code-view streaming endpoints
export { subscribeFileChange, subscribeRepoChange } from "./repo-change.ts";
// Repository resolution
export {
  gitInfoEqual,
  hasGitDir,
  resolveGitInfo,
  subscribeGitInfo,
} from "./resolve.ts";

// Diff review
export { getDiff, getStatus, parseNameStatus } from "./review.ts";
// Path security
export { resolveUnder } from "./safe-path.ts";
// File-preview classification (drives `FsReadFileOutput.kind`); node-free,
// also exported via the `kolu-git/previewable` subpath for browser clients.
export {
  BINARY_PREVIEWABLE_EXTENSIONS,
  isBinaryPreviewable,
  isRasterImage,
  RASTER_IMAGE_EXTENSIONS,
  SANDBOX_PREVIEWABLE_EXTENSIONS,
} from "./previewable.ts";
// Schemas
export {
  FsListAllInputSchema,
  type FsListAllOutput,
  FsListAllOutputSchema,
  FsReadFileInputSchema,
  type FsReadFileOutput,
  FsReadFileOutputSchema,
  type GitBaseRef,
  GitBaseRefSchema,
  type GitChangedFile,
  GitChangedFileSchema,
  type GitChangeStatus,
  GitChangeStatusSchema,
  GitDiffInputSchema,
  type GitDiffMode,
  GitDiffModeSchema,
  type GitDiffOutput,
  GitDiffOutputSchema,
  type GitInfo,
  GitInfoSchema,
  GitStatusInputSchema,
  type GitStatusOutput,
  GitStatusOutputSchema,
  WorktreeCreateInputSchema,
  WorktreeCreateOutputSchema,
  WorktreeNameSchema,
  WorktreeRemoveInputSchema,
} from "./schemas.ts";
// Working-tree watcher (axis 4, parcel-watcher backed)
export { watchWorkingTree } from "./working-tree-watcher.ts";
// Worktree operations
export {
  detectDefaultBranch,
  worktreeCreate,
  worktreeRemove,
} from "./worktree.ts";
