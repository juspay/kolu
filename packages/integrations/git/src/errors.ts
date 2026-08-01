/** Typed error types for kolu-git operations.
 *  All fallible functions return GitResult<T> instead of throwing. */

/** Discriminated union of all git operation errors. */
export type GitError =
  | { code: "NOT_A_REPO" }
  | { code: "BASE_BRANCH_NOT_FOUND"; ref: string; message: string }
  | { code: "WORKTREE_NAME_COLLISION"; name: string; message: string }
  | { code: "PATH_ESCAPES_ROOT"; root: string; child: string }
  /** The path is gone — the delete-while-viewing race, and the cleaned build
   *  output under an open row. Its own member so "is this failure a missing
   *  path?" has ONE authority: `unwrapGit` maps it to a typed `NOT_FOUND`
   *  structurally, instead of the wire contract resting on an errno string
   *  surviving re-wrapping into a `GIT_FAILED` message. */
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
 *  crossing a boundary). The single source of truth for the delete-while-viewing
 *  race, shared by the kolu-git leaf that classifies its own log level and by
 *  servePadi's `fileGoneAsNotFound` wire mapping — so the two can't drift.
 *
 *  **A native errno is authoritative, and it is consulted ALONE.** Reading the
 *  code and the message as alternatives let an error that carries its own,
 *  different code still be classified by its text: an `EACCES` on a path that
 *  merely CONTAINS the token — `/repo/ENOENT-artifacts/out` — answered true and
 *  became a `NOT_FOUND` that consumers swallow as an expected deletion, hiding a
 *  real permission fault. The message is a fallback for a boundary that STRIPPED
 *  the code, not a second opinion about an error that still has one.
 *
 *  The fallback matches the errno SHAPE (`ENOENT:` as node spells it —
 *  `ENOENT: no such file or directory, scandir '…'`) rather than a bare
 *  substring, so a path is not mistaken for a status. */
export function isFileGoneError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code === "ENOENT";
  const message = String((e as Error | null)?.message ?? "");
  return (
    /\bENOENT\b\s*:/.test(message) || /no such file or directory/i.test(message)
  );
}
