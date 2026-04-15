/** Typed error types for kolu-git operations.
 *  All fallible functions return GitResult<T> instead of throwing. */

/** Discriminated union of all git operation errors. */
export type GitError =
  | { code: "NOT_A_REPO" }
  | { code: "BASE_BRANCH_NOT_FOUND"; ref: string; message: string }
  | { code: "WORKTREE_NAME_EXHAUSTED"; message: string }
  | { code: "PATH_ESCAPES_ROOT"; root: string; child: string }
  | { code: "GIT_FAILED"; message: string };

/** Sum type for fallible git operations. */
export type GitResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: GitError };

export function ok<T>(value: T): GitResult<T> {
  return { ok: true, value };
}

export function err<T>(error: GitError): GitResult<T> {
  return { ok: false, error };
}
