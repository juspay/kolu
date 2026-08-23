/**
 * Pi's AgentAdapter — wires core into the shared `AgentAdapter<Session, Info>`
 * contract from anyagent.
 *
 * Directory-keyed like codex/opencode: `resolveSessions` scans the cwd's
 * session directory newest-first and offers every candidate; the
 * orchestrator's ownership arbiter assigns one per terminal
 * (juspay/kolu#2057).
 *
 * `externalChanges` IS implemented — pi writes its session file at launch,
 * BEFORE any title event can name it (the preexec hint precedes the file),
 * so a filesystem wake is the only signal that a session appeared; the
 * two-level tree watcher (`subscribeSessionsTree`) fires on both levels.
 * `isPresent` gates install on the binary being foregrounded or the
 * sessions tree already existing — a fresh machine that never ran pi pays
 * no watcher cost (issue #698).
 */

import { type AgentAdapter, matchesAgent } from "anyagent";
import {
  findSessionsByDirectory,
  type PiSession,
  piHomePresent,
  subscribeSessionsTree,
} from "./core.ts";
import type { PiInfo } from "./schemas.ts";
import { createPiWatcher } from "./session-watcher.ts";

export const piAdapter: AgentAdapter<PiSession, PiInfo> = {
  kind: "pi",

  resolveSessions(state, log) {
    if (!matchesAgent(state, "pi")) return [];
    return findSessionsByDirectory(state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  sessionStartedAt(session) {
    return session.startedAt;
  },

  createWatcher(session, onChange, log) {
    return createPiWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, "pi") || piHomePresent();
    },
    install(onChange, onError, log) {
      subscribeSessionsTree(onChange, onError, log);
    },
  },
};
