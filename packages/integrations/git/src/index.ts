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
  type GitInfo,
  type GitChangeStatus,
  type GitChangedFile,
  type GitDiffMode,
  type GitBaseRef,
  type GitStatusOutput,
  type GitDiffOutput,
} from "./schemas.ts";

// Repository resolution
export {
  resolveGitInfo,
  watchGitHead,
  gitInfoEqual,
  hasGitDir,
} from "./resolve.ts";

// Worktree operations
export {
  worktreeCreate,
  worktreeRemove,
  detectDefaultBranch,
} from "./worktree.ts";

// Diff review
export { getStatus, getDiff, parseNameStatus } from "./review.ts";

// Path security
export { resolveUnder } from "./safe-path.ts";

// Name generation
export { randomName } from "./random-name.ts";
