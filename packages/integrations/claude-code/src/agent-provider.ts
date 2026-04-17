/**
 * Claude Code's AgentProvider — wires the package's existing helpers
 * (`readSessionFile`, `subscribeSessionsDir`, `createSessionWatcher`) into
 * the shared `AgentProvider<Session, Info>` contract from anyagent.
 *
 * The server's generic agent orchestrator consumes this and needs no
 * claude-code-specific knowledge.
 */

import type { AgentProvider } from "anyagent";
import { readSessionFile, subscribeSessionsDir } from "./index.ts";
import { createSessionWatcher } from "./session-watcher.ts";
import type { SessionFile, ClaudeCodeInfo } from "./index.ts";

export const claudeCodeProvider: AgentProvider<SessionFile, ClaudeCodeInfo> = {
  kind: "claude-code",

  resolveSession(state, log) {
    if (state.foregroundPid === undefined) return null;
    return readSessionFile(state.foregroundPid, log);
  },

  sessionKey(session) {
    return session.sessionId;
  },

  createWatcher(session, onChange, log) {
    return createSessionWatcher(session, onChange, log);
  },

  subscribeExternalChanges(onChange, onError) {
    return subscribeSessionsDir(onChange, onError);
  },
};
