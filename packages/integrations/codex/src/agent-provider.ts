import type { AgentProvider } from "anyagent";
import { createCodexWatcher } from "./session-watcher.ts";
import {
  findSessionByDirectory,
  type CodexInfo,
  type CodexSession,
} from "./index.ts";

const CODEX_BASENAMES = new Set(["codex", "codex-tui"]);

export const codexProvider: AgentProvider<CodexSession, CodexInfo> = {
  kind: "codex",

  resolveSession(state, log) {
    const basename = state.readForegroundBasename();
    if (!basename || !CODEX_BASENAMES.has(basename)) return null;
    return findSessionByDirectory(state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  createWatcher(session, onChange, log) {
    return createCodexWatcher(session, onChange, log);
  },
};
