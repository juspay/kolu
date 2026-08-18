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
  resolveGrokSessions,
} from "./core.ts";
import type { GrokInfo } from "./schemas.ts";
import { createGrokWatcher } from "./session-watcher.ts";

/** The executable name this agent runs as — see `AgentAdapter.commandName`.
 *  Declared once here and used for BOTH the adapter's advertised identity and
 *  its own `matchesAgent` checks, so the two cannot drift. */
const AGENT_COMMAND = "grok";

export const grokAdapter: AgentAdapter<GrokSession, GrokInfo> = {
  kind: "grok",
  commandName: AGENT_COMMAND,

  // Pid-anchored whenever `active_sessions.json` names the foreground pid, so
  // the usual match is exclusive by construction and yields one candidate. The
  // one guess left — no pid sample yet, newest session under the cwd — is
  // offered as a candidate like any other, and the orchestrator's ownership
  // arbiter keeps it from landing on a terminal that already has a session
  // (juspay/kolu#2057).
  resolveSessions(state, log) {
    if (!matchesAgent(state, AGENT_COMMAND)) return [];
    return resolveGrokSessions(state.foregroundPid, state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  sessionStartedAt(session) {
    return session.startedAt;
  },

  createWatcher(session, onChange, log) {
    return createGrokWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, AGENT_COMMAND) || grokHomePresent();
    },
    install(onChange, onError, log) {
      subscribeActiveSessions(onChange, onError, log);
    },
  },
};
