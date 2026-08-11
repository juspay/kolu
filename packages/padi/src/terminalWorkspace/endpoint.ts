/**
 * `terminalWorkspace/endpoint` (padi-internal) — the host-side fs/git wrapper,
 * lifted out of kolu-server's `localEndpoint` (R6) and folded into padi (L7) once
 * padi became its sole consumer. A thin layer over
 * `kolu-git`: it unwraps each
 * `GitResult` into a value or a thrown DECLARED tagged error (fail-fast — a git error
 * surfaces, never collapses to an empty result), and adapts the watcher
 * callbacks. The terminal-endpoint ORCHESTRATION around it (spawn · adopt · the
 * registry) is padi's; only this leaf wrapper is the fs/git face.
 *
 * This is the NODE face (it shells out to git via kolu-git's root), kept
 * strictly separate from the browser-safe terminal vocabulary
 * (`@kolu/terminal-vocab/schema`). The two interfaces below describe the
 * impl, so they live with it; padi's composite `TerminalEndpoint` imports them
 * as types.
 */

import {
  getDiff,
  getStatus,
  type GitResult,
  listAll,
  listDirectory,
  listIgnored,
  readFile,
  filePreviewTag,
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
import { match } from "ts-pattern";
import {
  FileGone,
  GitFailed,
  WorktreeBaseBranchMissing,
  WorktreeNameCollision,
} from "../errors.ts";

/** Filesystem operations scoped to an endpoint's host machine. Returns
 *  already-unwrapped values; implementations throw a DECLARED tagged error on failure so
 *  consumers don't repeat error-unwrapping at every call site. Covers BOTH
 *  one-shot reads AND watcher subscriptions — same volatility axis ("where the
 *  FS lives"), one place the surface binds. */
export interface TerminalEndpointFs {
  listAll(repoPath: string): Promise<FsListAllOutput>;
  /** The gitignored complement of {@link listAll}, collapsed (a fully-ignored
   *  directory is one trailing-slash entry). Its own member, not a flag on
   *  `listAll`, so a consumer can query the two independently — see
   *  `FsListIgnoredInputSchema` for why that separation is load-bearing. */
  listIgnored(repoPath: string): Promise<FsListIgnoredOutput>;
  /** ONE level of a directory, read on demand. Answers an expand of a row
   *  {@link listIgnored}'s collapse left childless — the tree holds no child
   *  under such a row, so without this the folder opens onto nothing. One
   *  level, so expanding `node_modules/` costs a readdir rather than the
   *  recursive listing git would have to produce. */
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
  subscribeRepoChange(repoPath: string, onChange: () => void): () => void;
  subscribeFileChange(
    repoPath: string,
    filePath: string,
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

/**
 * Unwrap a `GitResult` into the success value or throw the surface's DECLARED
 * tagged error for the client. Shared by the fs/git wrapper below and
 * kolu-server's raw git handlers (which import it from this package).
 *
 * This lived in its own kolu-server file (`server/src/unwrapGit.ts`)
 * specifically to keep `local.ts` out of an import cycle with `surface.ts`
 * (#1005). Co-locating it here is now safe: (a) this module imports nothing
 * from any surface module, and (b) its remaining external consumer —
 * kolu-server's `router.ts` — reaches it across the `@kolu/terminal-vocab`
 * package edge, not within kolu-server, so the #1005 cycle cannot reform.
 * `./errors.ts` is schema-only and imports nothing of padi's, so taking it here
 * cannot reform the cycle either.
 *
 * The six `GitResult` codes map onto FOUR classes, not six, because that is how
 * many the wire ever distinguished: `FILE_GONE` is the branch point the Code
 * tab's delete-while-viewing handling keys on, `BASE_BRANCH_NOT_FOUND` and
 * `WORKTREE_NAME_COLLISION` are the two refusals a user can correct, and the
 * remaining three (`PATH_ESCAPES_ROOT`, `GIT_FAILED`, `NOT_A_REPO`) all spelled
 * ONE oRPC code (`INTERNAL_SERVER_ERROR`) and were indistinguishable to every
 * consumer — so they stay one class rather than minting discriminants nobody
 * branches on. The `match` stays EXHAUSTIVE, so a new `GitResult` code is still
 * a compile error here.
 */
export function unwrapGit<T>(result: GitResult<T>): T {
  if (result.ok) return result.value;
  throw (
    match(result.error)
      .with(
        { code: "BASE_BRANCH_NOT_FOUND" },
        (e) => new WorktreeBaseBranchMissing({ detail: e.message }),
      )
      .with(
        { code: "WORKTREE_NAME_COLLISION" },
        (e) => new WorktreeNameCollision({ detail: e.message }),
      )
      .with(
        { code: "PATH_ESCAPES_ROOT" },
        (e) => new GitFailed({ detail: `path escapes root: ${e.child}` }),
      )
      // The typed "gone" the Code tab's delete-while-viewing handling keys on. It
      // comes from the sum type, so no caller has to re-sniff an errno out of a
      // message to recover it.
      .with({ code: "FILE_GONE" }, (e) => new FileGone({ path: e.path }))
      .with({ code: "GIT_FAILED" }, (e) => new GitFailed({ detail: e.message }))
      .with(
        { code: "NOT_A_REPO" },
        () => new GitFailed({ detail: "Not a git repository" }),
      )
      .exhaustive()
  );
}

/** The host-side fs/git endpoint — `createTerminalWorkspaceEndpoint`'s two faces
 *  (`fs`, `git`). The NAMED injection seam, so the shape is spelled once instead
 *  of re-derived at each boundary. */
export type TerminalWorkspaceEndpoint = {
  fs: TerminalEndpointFs;
  git: TerminalEndpointGit;
};

/** The host-side fs/git endpoint — shell out to `kolu-git` on this machine. One
 *  impl the Code tab's reads + watcher pulses bind to: kolu-server binds it to
 *  its in-process `TerminalEndpoint`, and padi's `padiFsGitDeps` exposes its
 *  watcher streams on `padiSurface`. `log` is injected — the package's lone host
 *  coupling, never a fallback knob. */
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
    subscribeRepoChange(repoPath, onChange) {
      return subscribeRepoChange(repoPath, onChange, log);
    },
    subscribeFileChange(repoPath, filePath, onChange) {
      return subscribeFileChange(repoPath, filePath, onChange, log);
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
