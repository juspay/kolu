/**
 * The local fs/git surface — kolu-git shell-outs adapted to the
 * `TerminalEndpointFs` / `TerminalEndpointGit` shapes, plus the
 * `GitResult → ORPCError` unwrap they share.
 *
 * Lives in `@kolu/terminal-dag` (not kolu-server) so BOTH hosts that read a
 * host's real filesystem consume ONE implementation:
 *   - kolu-server's `LocalTerminalEndpoint` (local terminals), and
 *   - `kolu-watcher` (P3), serving the remote host's fs/git over ssh.
 *
 * Both shell out to the same `kolu-git` on the machine the files actually
 * live on — so the only difference between a local and a remote Code tab is
 * which process runs this, never the logic.
 */

import { ORPCError } from "@orpc/server";
import type {
  TerminalEndpointFs,
  TerminalEndpointGit,
} from "kolu-common/terminalEndpoint";
import {
  getDiff,
  getStatus,
  type GitResult,
  listAll,
  readFile,
  statFileMtimeMs,
  subscribeFileChange,
  subscribeRepoChange,
} from "kolu-git";
import type { GitDiffMode } from "kolu-git/schemas";
import type { Logger } from "pino";
import { match } from "ts-pattern";

/** Unwrap a `GitResult` into its success value, or throw an `ORPCError` the
 *  surface layer serialises for the client. Shared by kolu-server's raw git
 *  handlers, `LocalTerminalEndpoint`'s fs/git, and kolu-watcher's served
 *  fs/git — one place maps each `GitError` code to a wire status. */
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

/** Build the fs + git surfaces over the machine's real filesystem, scoped to
 *  `log`. The returned objects satisfy `TerminalEndpointFs`/`TerminalEndpointGit`
 *  directly (already-unwrapped values; failures throw `ORPCError`). */
export function makeFsGit(log: Logger): {
  fs: TerminalEndpointFs;
  git: TerminalEndpointGit;
} {
  const fs: TerminalEndpointFs = {
    async listAll(repoPath) {
      return { paths: unwrapGit(await listAll(repoPath, log)) };
    },
    async readFile(repoPath, filePath) {
      return unwrapGit(await readFile(repoPath, filePath, log));
    },
    async statFileMtimeMs(repoPath, filePath) {
      return unwrapGit(await statFileMtimeMs(repoPath, filePath, log));
    },
    subscribeRepoChange(repoPath, onChange) {
      return subscribeRepoChange(repoPath, onChange, log);
    },
    subscribeFileChange(repoPath, filePath, onChange) {
      return subscribeFileChange(repoPath, filePath, onChange, log);
    },
  };
  const git: TerminalEndpointGit = {
    async getStatus(repoPath, mode: GitDiffMode) {
      return unwrapGit(await getStatus(repoPath, mode, log));
    },
    async getDiff(repoPath, filePath, mode, oldPath) {
      return unwrapGit(await getDiff(repoPath, filePath, mode, log, oldPath));
    },
  };
  return { fs, git };
}
