/**
 * Codex's AgentProvider — wires the package's existing helpers
 * (`findSessionByDirectory`, `createCodexWatcher`, `subscribeCodexDb`)
 * into the shared `AgentProvider<Session, Info>` contract from anyagent.
 *
 * `subscribeExternalChanges` IS implemented here — unlike OpenCode,
 * Codex can have a running `codex` TUI process whose thread row doesn't
 * exist in SQLite until the first exchange completes. A bare title
 * event won't fire at that moment, so we also rewake on every WAL write
 * and let `resolveSession` re-check the DB. When the thread appears,
 * match succeeds.
 */

import type { AgentProvider } from "anyagent";
import { findSessionByDirectory } from "./index.ts";
import { createCodexWatcher } from "./session-watcher.ts";
import { subscribeCodexDb } from "./wal-watcher.ts";
import type { CodexSession, CodexInfo } from "./index.ts";

export const codexProvider: AgentProvider<CodexSession, CodexInfo> = {
  kind: "codex",

  resolveSession(state, log) {
    const foreground = state.readForegroundBasename();
    const invoked = state.readInvokedAgentBasename();
    if (foreground !== "codex" && invoked !== "codex") return null;
    return findSessionByDirectory(state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  createWatcher(session, onChange, log) {
    return createCodexWatcher(session, onChange, log);
  },

  subscribeExternalChanges(onChange, onError, log) {
    return subscribeCodexDb(onChange, onError, log);
  },
};
