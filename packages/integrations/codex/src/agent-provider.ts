import type { AgentProvider } from "anyagent";
import { findSessionByDirectory } from "./index.ts";
import { createCodexWatcher } from "./session-watcher.ts";
import { subscribeCodexDb } from "./wal-watcher.ts";
import type { CodexSession, CodexInfo } from "./index.ts";

export const codexProvider: AgentProvider<CodexSession, CodexInfo> = {
  kind: "codex",

  resolveSession(state, log) {
    if (state.readForegroundBasename() !== "codex") return null;
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
