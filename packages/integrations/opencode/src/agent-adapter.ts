import { type AgentAdapter, matchesAgent } from "anyagent";
import { findSessionsByDirectory, type OpenCodeSession } from "./core.ts";
import { type OpenCodeInfo, opencodeVocab } from "./schemas.ts";
import { createOpenCodeWatcher } from "./session-watcher.ts";

export const opencodeAdapter: AgentAdapter<OpenCodeSession, OpenCodeInfo> = {
  kind: "opencode",

  resolveSessions(state, log) {
    if (!matchesAgent(state, opencodeVocab.cli)) return [];
    return findSessionsByDirectory(state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  sessionStartedAt(session) {
    return session.startedAt;
  },

  createWatcher(session, onChange, log) {
    return createOpenCodeWatcher(session, onChange, log);
  },
};
