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
  resolveXyneSession,
  type XyneSession,
  xyneSessionsPresent,
} from "./core.ts";
import type { XyneInfo } from "./schemas.ts";
import { subscribeSessionDirs } from "./sessions-dir-watcher.ts";
import { createXyneWatcher } from "./session-watcher.ts";

export const xyneAdapter: AgentAdapter<XyneSession, XyneInfo> = {
  kind: "xyne",

  resolveSession(state, log) {
    if (!matchesAgent(state, "xyne")) return null;
    return resolveXyneSession(state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
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
