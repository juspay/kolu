/**
 * Claude Code's AgentProvider — wires the package's existing helpers
 * (`readSessionFile`, `subscribeSessionsDir`, `createSessionWatcher`) into
 * the shared `AgentProvider<Session, Info>` contract from anyagent.
 *
 * The server's generic agent orchestrator consumes this and needs no
 * claude-code-specific knowledge.
 *
 * `externalChanges.isPresent` gates `install` on either (a) `claude`
 * being foregrounded in some terminal, or (b) `~/.claude/sessions/`
 * existing on disk already. Matching is not PID-based here —
 * `resolveSession` returns null until claude writes its session file,
 * which is exactly what the SESSIONS_DIR watcher fires on — so we need
 * a cheaper "might be running here" signal to authorize the watcher
 * install. `matchesAgent(state, "claude")` covers the OSC 633;E preexec
 * hint and the kernel foreground basename; the directory check covers
 * the PID-match path where a session file can appear with no preexec
 * signal because claude is invoked via a shim (npx, wrapper) or via
 * scenarios the kolu-instrumented shell never saw. Neither holds on a
 * fresh machine that has never run Claude — no watcher, no logs
 * (issue #698).
 */

import fs from "node:fs";
import { type AgentProvider, matchesAgent } from "anyagent";
import type { ClaudeCodeInfo, SessionFile } from "./index.ts";
import {
  readSessionFile,
  SESSIONS_DIR,
  subscribeSessionsDir,
} from "./index.ts";
import { createSessionWatcher } from "./session-watcher.ts";

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
      return matchesAgent(state, "claude") || fs.existsSync(SESSIONS_DIR);
    },
    install(onChange, onError) {
      subscribeSessionsDir(onChange, onError);
    },
  },
};
