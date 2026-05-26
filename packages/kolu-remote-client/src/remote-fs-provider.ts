/**
 * Remote fs provider — `FsProvider` impl that proxies `listAll`,
 * `readFile`, and `statFileMtimeMs` to the remote agent's
 * `fs.listAll` / `fs.readFile` / `fs.statFileMtimeMs` RPCs.
 *
 * Phase 2b of kolu#951. Each call is a single round-trip; the agent
 * runs the LOCAL `kolu-git` `listAll` / `readFile` / `statFileMtimeMs`
 * against the remote filesystem.
 *
 * **Prototype scope.** The agent-side handlers for these methods are
 * stubbed in `kolu-remote-agent/src/index.ts` (TODO Phase 2b in that
 * file). Once those land, this client compiles and dispatches
 * end-to-end with no changes here.
 */

import type { FsProvider } from "kolu-git";
import type { GitResult } from "kolu-git";
import type { Logger } from "kolu-shared";
import type { HostSessionLike } from "./host-session.ts";

export function remoteFsProvider(session: HostSessionLike): FsProvider {
  return {
    async listAll(
      repoPath: string,
      _log?: Logger,
    ): Promise<GitResult<string[]>> {
      const result = await session.call("fs.listAll", { repoPath });
      // The agent's handler already returns `GitResult<string[]>` (the
      // local listAll's shape); we forward it verbatim.
      return result as GitResult<string[]>;
    },
    async readFile(
      repoPath: string,
      filePath: string,
      _log?: Logger,
    ): Promise<GitResult<{ content: string; truncated: boolean }>> {
      const result = await session.call("fs.readFile", { repoPath, filePath });
      return result as GitResult<{ content: string; truncated: boolean }>;
    },
    async statFileMtimeMs(
      repoPath: string,
      filePath: string,
      _log?: Logger,
    ): Promise<GitResult<number>> {
      const result = await session.call("fs.statFileMtimeMs", {
        repoPath,
        filePath,
      });
      return result as GitResult<number>;
    },
  };
}
