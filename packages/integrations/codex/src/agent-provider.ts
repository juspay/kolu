/**
 * Codex's AgentProvider — wires the package's existing helpers
 * (`findSessionByDirectory`, `createCodexWatcher`, `subscribeCodexDb`)
 * into the shared `AgentProvider<Session, Info>` contract from anyagent.
 *
 * `externalChanges` IS implemented here — unlike OpenCode, Codex can
 * have a running `codex` TUI process whose thread row doesn't exist in
 * SQLite until the first exchange completes. A bare title event won't
 * fire at that moment, so we also rewake on every WAL write and let
 * `resolveSession` re-check the DB. When the thread appears, match
 * succeeds. `isPresent` gates `install` on either (a) the binary being
 * foregrounded in some terminal, or (b) `~/.codex` existing on disk
 * already (user has used Codex on this machine before). Neither holds
 * on a fresh machine that has never run Codex — no watcher, no logs,
 * no missing-directory error (issue #698).
 */

import { type AgentProvider, matchesAgent } from "anyagent";
import {
  type CodexSession,
  findSessionByDirectory,
  resolveCodexPaths,
} from "./core.ts";
import type { CodexInfo } from "./schemas.ts";
import { createCodexWatcher } from "./session-watcher.ts";

export const codexProvider: AgentProvider<CodexSession, CodexInfo> = {
  kind: "codex",

  async resolveSession(state, executor, log) {
    if (!matchesAgent(state, "codex")) return null;
    return findSessionByDirectory(state.cwd, executor, log);
  },

  sessionKey(session) {
    return session.id;
  },

  createWatcher(session, executor, onChange, log) {
    return createCodexWatcher(session, executor, onChange, log);
  },

  externalChanges: {
    async isPresent(state, executor) {
      if (matchesAgent(state, "codex")) return true;
      const paths = await resolveCodexPaths(executor);
      if (!paths) return false;
      try {
        await executor.statMtimeMs(paths.dir);
        return true;
      } catch {
        return false;
      }
    },
    async install(executor, onChange, onError, log) {
      const paths = await resolveCodexPaths(executor, log);
      if (!paths) return { stop: () => {} };
      try {
        return await executor.watch(
          paths.walPath,
          () => {
            try {
              onChange();
            } catch (err) {
              onError(err);
            }
          },
          { recursive: false },
        );
      } catch (err) {
        log.debug({ err, path: paths.walPath }, "codex WAL watch failed");
        return { stop: () => {} };
      }
    },
  },
};
