import fs from "node:fs";
import { type AgentAdapter, matchesAgent } from "anyagent";
import { CODEX_DIR } from "./config.ts";
import { type CodexSession, findSessionsByDirectory } from "./core.ts";
import { type CodexInfo, codexVocab } from "./schemas.ts";
import { createCodexWatcher } from "./session-watcher.ts";
import { subscribeCodexDb } from "./wal-watcher.ts";

export const codexAdapter: AgentAdapter<CodexSession, CodexInfo> = {
  kind: "codex",

  resolveSessions(state, log) {
    if (!matchesAgent(state, codexVocab.cli)) return [];
    return findSessionsByDirectory(state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  sessionStartedAt(session) {
    return session.startedAt;
  },

  createWatcher(session, onChange, log) {
    return createCodexWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, codexVocab.cli) || fs.existsSync(CODEX_DIR);
    },
    install(onChange, onError, log) {
      subscribeCodexDb(onChange, onError, log);
    },
  },
};
