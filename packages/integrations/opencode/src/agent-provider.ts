/**
 * OpenCode's AgentProvider — wires the package's existing helpers
 * (`findSessionByDirectory`, `createOpenCodeWatcher`) into the shared
 * `AgentProvider<Session, Info>` contract from anyagent.
 *
 * `subscribeExternalChanges` is intentionally omitted: OpenCode's TUI
 * process owns its session throughout its lifetime, and the session only
 * appears in the database *after* the first user exchange — but by then
 * a title event has already fired, so re-resolving on title covers the
 * appearance case. WAL changes are per-session state, owned by
 * `createOpenCodeWatcher`, not session-identity changes.
 */

import { type AgentProvider, matchesAgent } from "anyagent";
import { findSessionByDirectory, type OpenCodeSession } from "./core.ts";
import type { OpenCodeInfo } from "./schemas.ts";
import { createOpenCodeWatcher } from "./session-watcher.ts";

export const opencodeProvider: AgentProvider<OpenCodeSession, OpenCodeInfo> = {
  kind: "opencode",

  resolveSession(state, log) {
    if (!matchesAgent(state, "opencode")) return null;
    return findSessionByDirectory(state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  createWatcher(session, onChange, log) {
    // OpenCode doesn't derive a peek-snippet yet — pass `null` so the
    // orchestrator clears `agentSnippet` alongside info updates and the
    // snippet doesn't shadow stale state from a previous integration.
    return createOpenCodeWatcher(session, (info) => onChange(info, null), log);
  },

  // subscribeExternalChanges: intentionally omitted.
};
