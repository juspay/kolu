/**
 * Unwrap a `GitResult` into the success value or throw an `ORPCError`
 * for the client. Pure helper shared by `router.ts`'s raw git handlers
 * and `terminalBackend/local.ts`'s fs/git surfaces.
 *
 * Lives in its own file (rather than `surface.ts`) so importing it from
 * `terminalBackend/local.ts` does not tug `local.ts` into a cycle with
 * `surface.ts`. See #1005.
 */

import { ORPCError } from "@orpc/server";
import type { GitResult } from "kolu-git";
import { match } from "ts-pattern";

export function unwrapGit<T>(result: GitResult<T>): T {
  if (result.ok) return result.value;
  const { status, message } = match(result.error)
    .with({ code: "BASE_BRANCH_NOT_FOUND" }, (e) => ({
      status: "PRECONDITION_FAILED" as const,
      message: e.message,
    }))
    .with({ code: "WORKTREE_NAME_COLLISION" }, (e) => ({
      status: "CONFLICT" as const,
      message: e.message,
    }))
    .with({ code: "PATH_ESCAPES_ROOT" }, (e) => ({
      status: "INTERNAL_SERVER_ERROR" as const,
      message: `path escapes root: ${e.child}`,
    }))
    .with({ code: "GIT_FAILED" }, (e) => ({
      status: "INTERNAL_SERVER_ERROR" as const,
      message: e.message,
    }))
    .with({ code: "NOT_A_REPO" }, () => ({
      status: "INTERNAL_SERVER_ERROR" as const,
      message: "Not a git repository",
    }))
    .exhaustive();
  throw new ORPCError(status, { message });
}
