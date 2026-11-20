import {
  FileGone,
  GitFailed,
  WorktreeBaseBranchMissing,
  WorktreeNameCollision,
} from "@kolu/padi-client/surface";
import {
  filePreviewTag,
  type GitError,
  type GitResult,
  getDiff,
  getStatus,
  listAll,
  listDirectory,
  listIgnored,
  readFile,
  subscribeFileChange,
  subscribeRepoChange,
} from "kolu-git";
import type {
  FsListAllOutput,
  FsListDirectoryOutput,
  FsListIgnoredOutput,
  GitDiffMode,
  GitDiffOutput,
  GitStatusOutput,
} from "kolu-git/schemas";
import type { Logger } from "pino";

/** Filesystem operations scoped to an endpoint's host machine. Returns
 *  already-unwrapped values; implementations throw a DECLARED tagged error on failure so
 *  consumers don't repeat error-unwrapping at every call site. */
export interface TerminalEndpointFs {
  listAll(repoPath: string): Promise<FsListAllOutput>;
  /** The gitignored complement of {@link listAll}, collapsed (a fully-ignored
   *  directory is one trailing-slash entry). */
  listIgnored(repoPath: string): Promise<FsListIgnoredOutput>;
  /** ONE level of a directory, read on demand. */
  listDirectory(
    repoPath: string,
    dirPath: string,
  ): Promise<FsListDirectoryOutput>;
  readFile(
    repoPath: string,
    filePath: string,
  ): Promise<{ content: string; truncated: boolean }>;
  filePreviewTag(
    repoPath: string,
    filePath: string,
    signal?: AbortSignal,
  ): Promise<string>;
  subscribeRepoChange(
    repoPath: string,
    asker: string,
    onChange: () => void,
  ): () => void;
  subscribeFileChange(
    repoPath: string,
    filePath: string,
    asker: string,
    onChange: () => void,
  ): () => void;
}

/** Git operations scoped to an endpoint's host machine. Same unwrap contract as
 *  `TerminalEndpointFs`. */
export interface TerminalEndpointGit {
  getStatus(repoPath: string, mode: GitDiffMode): Promise<GitStatusOutput>;
  getDiff(
    repoPath: string,
    filePath: string,
    mode: GitDiffMode,
    oldPath?: string,
  ): Promise<GitDiffOutput>;
}

type GitErrorClassTable = {
  [C in GitError["code"]]: (error: Extract<GitError, { code: C }>) => unknown;
};

const GIT_ERROR_CLASS: GitErrorClassTable = {
  BASE_BRANCH_NOT_FOUND: (e) =>
    new WorktreeBaseBranchMissing({ detail: e.message }),
  WORKTREE_NAME_COLLISION: (e) =>
    new WorktreeNameCollision({ detail: e.message }),
  PATH_ESCAPES_ROOT: (e) =>
    new GitFailed({ detail: `path escapes root: ${e.child}` }),
  FILE_GONE: (e) => new FileGone({ path: e.path }),
  GIT_FAILED: (e) => new GitFailed({ detail: e.message }),
  NOT_A_REPO: () => new GitFailed({ detail: "Not a git repository" }),
};

/**
 * Unwrap a `GitResult` into the success value or throw the surface's DECLARED
 * tagged error for the client. Shared by the fs/git wrapper below and
 * kolu-server's raw git handlers (which import it from this package).
 */
export function unwrapGit<T>(result: GitResult<T>): T {
  if (result.ok) return result.value;
  const toDeclared = GIT_ERROR_CLASS[result.error.code] as (
    error: GitError,
  ) => unknown;
  throw toDeclared(result.error);
}

/** The host-side fs/git endpoint — `createTerminalWorkspaceEndpoint`'s two faces
 *  (`fs`, `git`). */
export type TerminalWorkspaceEndpoint = {
  fs: TerminalEndpointFs;
  git: TerminalEndpointGit;
};

/** The host-side fs/git endpoint — shell out to `kolu-git` on this machine. */
export function createTerminalWorkspaceEndpoint(
  log: Logger,
): TerminalWorkspaceEndpoint {
  const fs: TerminalEndpointFs = {
    async listAll(repoPath: string): Promise<FsListAllOutput> {
      return { paths: unwrapGit(await listAll(repoPath, log)) };
    },
    async listIgnored(repoPath: string): Promise<FsListIgnoredOutput> {
      return { paths: unwrapGit(await listIgnored(repoPath, log)) };
    },
    async listDirectory(
      repoPath: string,
      dirPath: string,
    ): Promise<FsListDirectoryOutput> {
      return { paths: unwrapGit(await listDirectory(repoPath, dirPath, log)) };
    },
    async readFile(repoPath, filePath) {
      return unwrapGit(await readFile(repoPath, filePath, log));
    },
    async filePreviewTag(repoPath, filePath, signal) {
      return unwrapGit(await filePreviewTag(repoPath, filePath, log, signal));
    },
    subscribeRepoChange(repoPath, asker, onChange) {
      return subscribeRepoChange(repoPath, asker, onChange, log);
    },
    subscribeFileChange(repoPath, filePath, asker, onChange) {
      return subscribeFileChange(repoPath, filePath, asker, onChange, log);
    },
  };
  const git: TerminalEndpointGit = {
    async getStatus(repoPath, mode: GitDiffMode): Promise<GitStatusOutput> {
      return unwrapGit(await getStatus(repoPath, mode, log));
    },
    async getDiff(repoPath, filePath, mode, oldPath): Promise<GitDiffOutput> {
      return unwrapGit(await getDiff(repoPath, filePath, mode, log, oldPath));
    },
  };
  return { fs, git };
}
