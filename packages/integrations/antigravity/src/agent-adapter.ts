/**
 * Antigravity CLI's AgentAdapter — wires core, the watcher and the screen
 * detector into anyagent's `AgentAdapter<Session, Info>` contract.
 *
 * Pid-anchored where the platform allows: the terminal's `agy` process names
 * its conversation by the presence lock it holds open, so `resolveSessions`
 * answers zero or one candidate and never reads the launch arguments (`/clear`
 * and `/fork` switch the conversation inside one process). Elsewhere the
 * directory cache stands in (`core.ts`).
 *
 * `externalChanges` wakes, coalesced, on `presence/` (a lock appears when a
 * conversation is created), `cache/` (the fallback's source) and `agy`'s top
 * directory (written after an existing conversation is opened, and at every
 * submit). `isPresent` gates the install on `agy` being in the foreground or
 * its directory existing, so a machine that never ran it pays nothing.
 */

import { type AgentAdapter, matchesAgent } from "anyagent";
import {
  type AntigravitySession,
  antigravityHomePresent,
  readStartedAt,
  resolveAntigravitySessions,
  subscribeAntigravityDirs,
} from "./core.ts";
import { type AntigravityInfo, antigravityVocab } from "./schemas.ts";
import {
  isAntigravityScreenPollable,
  promoteAntigravityFromScreen,
  TAIL_REGION_LINES,
} from "./screen.ts";
import { createAntigravityWatcher } from "./session-watcher.ts";

/** A conversation's first line never changes once written; the arbiter asks
 *  for it on every reconcile, so a known answer is kept. */
const startedAtById = new Map<string, number>();

export const antigravityAdapter: AgentAdapter<
  AntigravitySession,
  AntigravityInfo
> = {
  kind: "antigravity",

  resolveSessions(state, log) {
    if (!matchesAgent(state, antigravityVocab.cli)) return [];
    return resolveAntigravitySessions(state.foregroundPid, state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  sessionStartedAt(session) {
    const known = startedAtById.get(session.id);
    if (known !== undefined) return known;
    const read = readStartedAt(session);
    if (read !== null) startedAtById.set(session.id, read);
    return read;
  },

  createWatcher(session, onChange, log) {
    return createAntigravityWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return (
        matchesAgent(state, antigravityVocab.cli) || antigravityHomePresent()
      );
    },
    install(onChange, onError, log) {
      subscribeAntigravityDirs(onChange, onError, log);
    },
  },

  screenScrape: {
    tailLines: TAIL_REGION_LINES,
    isPollable: isAntigravityScreenPollable,
    promote: promoteAntigravityFromScreen,
  },
};
