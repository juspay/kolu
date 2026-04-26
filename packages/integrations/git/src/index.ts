/** kolu-git — pure git operations for Kolu.
 *
 *  All fallible functions return GitResult<T> instead of throwing.
 *  Functions accept an optional Logger for instrumentation. */

// Name generation
export { randomName } from "memorable-names";
// File tree browsing
export { listAll, readFile } from "./browse.ts";
// Error types
export { err, type GitError, type GitResult, ok } from "./errors.ts";
// Repository resolution
export {
  gitInfoEqual,
  hasGitDir,
  resolveGitInfo,
  subscribeGitInfo,
  watchGitHead,
} from "./resolve.ts";

// Diff review
export { getDiff, getStatus, parseNameStatus } from "./review.ts";
// Path security
export { resolveUnder } from "./safe-path.ts";
// Schemas
export {
  FsListAllInputSchema,
  type FsListAllOutput,
  FsListAllOutputSchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
  type FsWatchEvent,
  FsWatchEventSchema,
  FsWatchInputSchema,
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
  WorktreeRemoveInputSchema,
} from "./schemas.ts";
// Worktree operations
export {
  detectDefaultBranch,
  worktreeCreate,
  worktreeRemove,
} from "./worktree.ts";
