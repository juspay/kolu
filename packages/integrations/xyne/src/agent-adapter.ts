/**
 * Xyne's AgentAdapter — wires core + watchers into the shared
 * `AgentAdapter<Session, Info>` contract from anyagent.
 *
 * `externalChanges` rewakes on sessions-dir writes so an Xyne TUI that
 * just wrote its first transcript (new file, no title event since) is
 * matched without waiting for the next OSC 2 — and so sleeping/live
 * re-matches follow the newest transcript for the cwd. Lazy: `isPresent`
 * gates install on the binary being foregrounded OR the sessions tree
 * existing.
 */

import { type AgentAdapter, matchesAgent } from "anyagent";
import {
  resolveXyneSessions,
  type XyneSession,
  xyneSessionsPresent,
  xyneSessionStartedAt,
} from "./core.ts";
import type { XyneInfo } from "./schemas.ts";
import { subscribeSessionDirs } from "./sessions-dir-watcher.ts";
import { createXyneWatcher } from "./session-watcher.ts";

export const xyneAdapter: AgentAdapter<XyneSession, XyneInfo> = {
  kind: "xyne",

  // No pid→session map exists for Xyne (unlike Grok's active_sessions.json),
  // so the one guess — newest transcript under the cwd — is the only
  // candidate offered; the orchestrator's ownership arbiter (juspay/kolu#2057)
  // keeps it from landing on a terminal that already holds a session.
  resolveSessions(state, log) {
    if (!matchesAgent(state, "xyne")) return [];
    return resolveXyneSessions(state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  // The transcript filename IS the birth certificate — parsed timestamp,
  // not mtime (a copy/wake's mkdir order would lie about the session's age).
  sessionStartedAt(session) {
    return xyneSessionStartedAt(session);
  },

  createWatcher(session, onChange, log) {
    return createXyneWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, "xyne") || xyneSessionsPresent();
    },
    install(onChange, onError, log) {
      subscribeSessionDirs(onChange, onError, log);
    },
  },
};
