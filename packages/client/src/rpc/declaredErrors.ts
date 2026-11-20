import type {
  FileGone,
  TerminalNotFound,
  WorktreeBaseBranchMissing,
} from "@kolu/padi-client/surface";
import { isTransportError } from "@kolu/surface/client";

export const TERMINAL_NOT_FOUND: TerminalNotFound["_tag"] = "TerminalNotFound";

export const FILE_GONE: FileGone["_tag"] = "FileGone";

export const WORKTREE_BASE_BRANCH_MISSING: WorktreeBaseBranchMissing["_tag"] =
  "WorktreeBaseBranchMissing";

export function isDeclared(err: unknown, tag: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    !isTransportError(err) &&
    (err as { readonly _tag?: unknown })._tag === tag
  );
}
