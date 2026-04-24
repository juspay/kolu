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
 * succeeds. `isPresent` gates `install` on the binary actually being
 * foregrounded in some terminal, so a fresh machine without `~/.codex`
 * pays no watcher cost.
 */

import { type AgentProvider, matchesAgent } from "anyagent";
import { findSessionByDirectory } from "./index.ts";
import { createCodexWatcher } from "./session-watcher.ts";
import { subscribeCodexDb } from "./wal-watcher.ts";
import type { CodexSession, CodexInfo } from "./index.ts";

export const codexProvider: AgentProvider<CodexSession, CodexInfo> = {
  kind: "codex",

  resolveSession(state, log) {
    if (!matchesAgent(state, "codex")) return null;
    return findSessionByDirectory(state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  createWatcher(session, onChange, log) {
    return createCodexWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, "codex");
    },
    install(onChange, onError, log) {
      subscribeCodexDb(onChange, onError, log);
    },
  },
};
