/** Provider interfaces — kolu-git's local-vs-remote receptacles.
 *
 *  Generalizes the existing `AgentProvider` pattern
 *  (`anyagent/src/agent-provider.ts:77`) across the git and fs surfaces.
 *  Each provider is a typed interface; the local impl wraps today's pure
 *  functions, and a future remote impl (Phase 2b, kolu-remote-client) is
 *  a drop-in replacement that talks to a remote kolu-agent over RPC.
 *
 *  Consumers (`meta/git.ts`, `surface.ts` streams) hold the interface,
 *  not the concrete impl — so adding a remote variant is a new file +
 *  one line at the construction site, not edits across every provider.
 */

import type { Logger } from "kolu-shared";
import { listAll, readFile, statFileMtimeMs } from "./browse.ts";
import type { GitResult } from "./errors.ts";
import { subscribeGitInfo } from "./resolve.ts";
import type { GitInfo } from "./schemas.ts";

// ── GitInfoProvider ──────────────────────────────────────────────────

/** A live subscription to git info for one terminal's cwd. Returned by
 *  `GitInfoProvider.subscribe`. Lifetime is the caller's; `stop()`
 *  releases every internal watcher. */
export interface GitInfoSubscription {
  /** Swap the watched cwd. Same-value calls are a no-op. */
  setCwd(next: string): void;
  /** Release every internal watcher. Idempotent. */
  stop(): void;
}

/** Live git-info source for one terminal. Each terminal picks a provider
 *  by its `meta.location`; the local impl reads the local filesystem,
 *  future remote impls send RPCs to a kolu-agent on the remote host. */
export interface GitInfoProvider {
  subscribe(
    initialCwd: string,
    onChange: (info: GitInfo | null) => void,
    log?: Logger,
  ): GitInfoSubscription;
}

/** Local impl — straight wrapper around `subscribeGitInfo`. Stateless;
 *  shared across every local terminal. */
export const localGitInfoProvider: GitInfoProvider = {
  subscribe(cwd, onChange, log) {
    return subscribeGitInfo(cwd, onChange, log);
  },
};

// ── FsProvider ────────────────────────────────────────────────────────

/** One-shot filesystem ops scoped to a repo. The Code-view streams
 *  (`fsListAll`, `fsReadFile`) and inspector route handlers consume these.
 *  Future remote impls proxy each call to a kolu-agent over RPC. */
export interface FsProvider {
  listAll(repoPath: string, log?: Logger): Promise<GitResult<string[]>>;
  readFile(
    repoPath: string,
    filePath: string,
    log?: Logger,
  ): Promise<GitResult<{ content: string; truncated: boolean }>>;
  statFileMtimeMs(
    repoPath: string,
    filePath: string,
    log?: Logger,
  ): Promise<GitResult<number>>;
}

/** Local impl — straight wrapper around the pure functions in `browse.ts`.
 *  Stateless; shared across every local repo path. */
export const localFsProvider: FsProvider = {
  listAll,
  readFile,
  statFileMtimeMs,
};
