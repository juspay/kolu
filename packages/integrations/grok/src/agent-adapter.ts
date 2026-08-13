/**
 * Grok Build's AgentAdapter — wires core + watcher into the shared
 * `AgentAdapter<Session, Info>` contract from anyagent.
 *
 * `externalChanges` rewakes on `active_sessions.json` writes so a Grok
 * TUI that just started (pid map updated, no title event yet) is matched
 * without waiting for the next OSC 2. Lazy: `isPresent` gates install
 * on the binary being foregrounded OR `~/.grok` existing.
 */

import { type AgentAdapter, matchesAgent } from "anyagent";
import { subscribeActiveSessions } from "./active-sessions-watcher.ts";
import {
  grokHomePresent,
  type GrokSession,
  resolveGrokSession,
} from "./core.ts";
import type { GrokInfo } from "./schemas.ts";
import { createGrokWatcher } from "./session-watcher.ts";

export const grokAdapter: AgentAdapter<GrokSession, GrokInfo> = {
  kind: "grok",

  // Pid-anchored whenever `active_sessions.json` names the foreground pid, so
  // the usual match is exclusive by construction and yields one candidate. The
  // one guess left — no pid sample yet, newest session under the cwd — is
  // offered as a candidate like any other, and the orchestrator's ownership
  // arbiter keeps it from landing on a terminal that already has a session
  // (juspay/kolu#2057).
  resolveSessions(state, log) {
    if (!matchesAgent(state, "grok")) return [];
    const session = resolveGrokSession(state.foregroundPid, state.cwd, log);
    return session ? [session] : [];
  },

  sessionKey(session) {
    return session.id;
  },

  createWatcher(session, onChange, log) {
    return createGrokWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, "grok") || grokHomePresent();
    },
    install(onChange, onError, log) {
      subscribeActiveSessions(onChange, onError, log);
    },
  },
};
