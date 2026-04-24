/**
 * Claude Code's AgentProvider — wires the package's existing helpers
 * (`readSessionFile`, `subscribeSessionsDir`, `createSessionWatcher`) into
 * the shared `AgentProvider<Session, Info>` contract from anyagent.
 *
 * The server's generic agent orchestrator consumes this and needs no
 * claude-code-specific knowledge.
 *
 * `externalChanges.isPresent` gates `install` on `claude` being
 * foregrounded in some terminal. Matching is not PID-based here —
 * `resolveSession` returns null until claude writes its session file,
 * which is exactly what the SESSIONS_DIR watcher fires on — so we need
 * a cheaper "might be running here" signal to authorize the watcher
 * install. `matchesAgent(state, "claude")` covers the OSC 633;E preexec
 * hint and the kernel foreground basename.
 */

import { type AgentProvider, matchesAgent } from "anyagent";
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

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, "claude");
    },
    install(onChange, onError) {
      subscribeSessionsDir(onChange, onError);
    },
  },
};
