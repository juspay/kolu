import fs from "node:fs";
import {
  type AgentAdapter,
  type AgentTerminalState,
  matchesAgent,
} from "anyagent";
import {
  readSessionFile,
  SESSIONS_DIR,
  type SessionFile,
  subscribeSessionsDir,
  watcherIdentityKey,
} from "./core.ts";
import { type ClaudeCodeInfo, claudeCodeVocab } from "./schemas.ts";
import {
  isScreenPollable,
  promoteFromScreen,
  TAIL_REGION_LINES,
} from "./screen.ts";
import { createSessionWatcher } from "./session-watcher.ts";

function claudeMightBeRunning(state: AgentTerminalState): boolean {
  if (matchesAgent(state, claudeCodeVocab.cli)) return true;
  return fs.existsSync(SESSIONS_DIR);
}

export const claudeCodeAdapter: AgentAdapter<SessionFile, ClaudeCodeInfo> = {
  kind: "claude-code",

  resolveSessions(state, log) {
    if (state.foregroundPid === undefined) return [];
    const session = readSessionFile(state.foregroundPid, log);
    if (session === "unreadable") return null;
    return session ? [session] : [];
  },

  sessionKey: watcherIdentityKey,

  presenceSessionId(session) {
    return session.sessionId;
  },

  sessionStartedAt(session) {
    return session.startedAt ?? null;
  },

  createWatcher(session, onChange, log) {
    return createSessionWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent: claudeMightBeRunning,
    install(onChange, onError, log) {
      subscribeSessionsDir(onChange, onError, log);
    },
  },

  screenScrape: {
    tailLines: TAIL_REGION_LINES,
    isPollable: isScreenPollable,
    promote: promoteFromScreen,
  },
};
