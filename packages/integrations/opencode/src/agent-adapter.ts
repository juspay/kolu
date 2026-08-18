/**
 * OpenCode's AgentAdapter — wires the package's existing helpers
 * (`findSessionsByDirectory`, `createOpenCodeWatcher`) into the shared
 * `AgentAdapter<Session, Info>` contract from anyagent.
 *
 * `subscribeExternalChanges` is intentionally omitted: OpenCode's TUI
 * process owns its session throughout its lifetime, and the session only
 * appears in the database *after* the first user exchange — but by then
 * a title event has already fired, so re-resolving on title covers the
 * appearance case. WAL changes are per-session state, owned by
 * `createOpenCodeWatcher`, not session-identity changes.
 */

import { type AgentAdapter, matchesAgent } from "anyagent";
import { findSessionsByDirectory, type OpenCodeSession } from "./core.ts";
import type { OpenCodeInfo } from "./schemas.ts";
import { createOpenCodeWatcher } from "./session-watcher.ts";

/** The executable name this agent runs as — see `AgentAdapter.commandName`.
 *  Declared once here and used for BOTH the adapter's advertised identity and
 *  its own `matchesAgent` checks, so the two cannot drift. */
const AGENT_COMMAND = "opencode";

export const opencodeAdapter: AgentAdapter<OpenCodeSession, OpenCodeInfo> = {
  kind: "opencode",
  commandName: AGENT_COMMAND,

  resolveSessions(state, log) {
    if (!matchesAgent(state, AGENT_COMMAND)) return [];
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

  // subscribeExternalChanges: intentionally omitted.
};
