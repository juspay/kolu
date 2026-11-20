import { type AgentAdapter, matchesAgent } from "anyagent";
import { subscribeActiveSessions } from "./active-sessions-watcher.ts";
import {
  grokHomePresent,
  type GrokSession,
  resolveGrokSessions,
} from "./core.ts";
import { type GrokInfo, grokVocab } from "./schemas.ts";
import { createGrokWatcher } from "./session-watcher.ts";

export const grokAdapter: AgentAdapter<GrokSession, GrokInfo> = {
  kind: "grok",

  resolveSessions(state, log) {
    if (!matchesAgent(state, grokVocab.cli)) return [];
    return resolveGrokSessions(state.foregroundPid, state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  sessionStartedAt(session) {
    return session.startedAt;
  },

  createWatcher(session, onChange, log) {
    return createGrokWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, grokVocab.cli) || grokHomePresent();
    },
    install(onChange, onError, log) {
      subscribeActiveSessions(onChange, onError, log);
    },
  },
};
