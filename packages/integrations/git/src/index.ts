/** kolu-git — pure git operations for Kolu.
 *
 *  All fallible functions return GitResult<T> instead of throwing.
 *  Functions accept an optional Logger for instrumentation. */

// Error types
export { type GitError, type GitResult, ok, err } from "./errors.ts";

// Schemas
export {
  GitInfoSchema,
  WorktreeCreateInputSchema,
  WorktreeCreateOutputSchema,
  WorktreeRemoveInputSchema,
  GitChangeStatusSchema,
  GitChangedFileSchema,
  GitDiffModeSchema,
  GitBaseRefSchema,
  GitStatusInputSchema,
  GitStatusOutputSchema,
  GitDiffInputSchema,
  GitDiffOutputSchema,
  FsListDirInputSchema,
  FsDirEntrySchema,
  FsListDirOutputSchema,
  FsReadFileInputSchema,
  FsReadFileOutputSchema,
  type GitInfo,
  type GitChangeStatus,
  type GitChangedFile,
  type GitDiffMode,
  type GitBaseRef,
  type GitStatusOutput,
  type GitDiffOutput,
  type FsListDirOutput,
} from "./schemas.ts";

// Repository resolution
export {
  resolveGitInfo,
  watchGitHead,
  gitInfoEqual,
  hasGitDir,
  subscribeGitInfo,
} from "./resolve.ts";

// Worktree operations
export {
  worktreeCreate,
  worktreeRemove,
  detectDefaultBranch,
} from "./worktree.ts";

// Diff review
export { getStatus, getDiff, parseNameStatus } from "./review.ts";

// File tree browsing
export { listDir, readFile } from "./browse.ts";

// Path security
export { resolveUnder } from "./safe-path.ts";

// Name generation
export { randomName } from "memorable-names";
