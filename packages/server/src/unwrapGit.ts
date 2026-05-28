/**
 * Translate a `GitResult<T>` into a plain `T`, or throw the
 * server-appropriate `ORPCError`. Pure — no dependency on the surface
 * declaration, the router builder, or any domain state.
 *
 * Lives outside `surface.ts` so `terminalBackend/local.ts` can call it
 * without dragging `surface.ts ↔ terminalBackend/` into a cycle (the
 * back-edge `local.ts → surface.ts` for `unwrapGit` was the last
 * lingering server import cycle after `surfaceCtx` moved to its own
 * holder).
 */

import { ORPCError } from "@orpc/server";
import { match } from "ts-pattern";
import type { GitResult } from "kolu-git";

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
