/** Discriminated union of all git operation errors. */
export type GitError =
  | { code: "NOT_A_REPO" }
  | { code: "BASE_BRANCH_NOT_FOUND"; ref: string; message: string }
  | { code: "WORKTREE_NAME_COLLISION"; name: string; message: string }
  | { code: "PATH_ESCAPES_ROOT"; root: string; child: string }
  /** The path is gone — the delete-while-viewing race. */
  | { code: "FILE_GONE"; path: string; message: string }
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
 *  crossing a boundary). */
export function isFileGoneError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code === "ENOENT";
  const message = String((e as Error | null)?.message ?? "");
  return (
    /\bENOENT\b\s*:/.test(message) || /no such file or directory/i.test(message)
  );
}
