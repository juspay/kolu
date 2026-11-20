import { type AgentAdapter, matchesAgent } from "anyagent";
import {
  resolveXyneSessions,
  type XyneSession,
  xyneSessionsPresent,
  xyneSessionStartedAt,
} from "./core.ts";
import { type XyneInfo, xyneVocab } from "./schemas.ts";
import { subscribeSessionDirs } from "./sessions-dir-watcher.ts";
import { createXyneWatcher } from "./session-watcher.ts";

export const xyneAdapter: AgentAdapter<XyneSession, XyneInfo> = {
  kind: "xyne",

  resolveSessions(state, log) {
    if (!matchesAgent(state, xyneVocab.cli)) return [];
    return resolveXyneSessions(state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  sessionStartedAt(session) {
    return xyneSessionStartedAt(session);
  },

  createWatcher(session, onChange, log) {
    return createXyneWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, xyneVocab.cli) || xyneSessionsPresent();
    },
    install(onChange, onError, log) {
      subscribeSessionDirs(onChange, onError, log);
    },
  },
};
