/** Typed error types for kolu-git operations.
 *  All fallible functions return GitResult<T> instead of throwing. */

/** Discriminated union of all git operation errors. */
export type GitError =
  | { code: "NOT_A_REPO" }
  | { code: "BASE_BRANCH_NOT_FOUND"; ref: string; message: string }
  | { code: "WORKTREE_NAME_COLLISION"; name: string; message: string }
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

/** True when a caught error means "the file is gone" — a raw node `ENOENT`,
 *  however it surfaced (a native `code`, or the message when the code was lost
 *  crossing a boundary). The single source of truth for the delete-while-viewing
 *  race, shared by the kolu-git leaf that classifies its own log level and by
 *  servePadi's `fileGoneAsNotFound` wire mapping — so the two can't drift. */
export function isFileGoneError(e: unknown): boolean {
  return (
    (e as { code?: string } | null)?.code === "ENOENT" ||
    /ENOENT|no such file/i.test(String((e as Error | null)?.message ?? ""))
  );
}
