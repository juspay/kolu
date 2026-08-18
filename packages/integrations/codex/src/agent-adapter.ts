/**
 * Codex's AgentAdapter — wires the package's existing helpers
 * (`findSessionsByDirectory`, `createCodexWatcher`, `subscribeCodexDb`)
 * into the shared `AgentAdapter<Session, Info>` contract from anyagent.
 *
 * `externalChanges` IS implemented here — unlike OpenCode, Codex can
 * have a running `codex` TUI process whose thread row doesn't exist in
 * SQLite until the first exchange completes. A bare title event won't
 * fire at that moment, so we also rewake on every WAL write and let
 * `resolveSessions` re-check the DB. When the thread appears, match
 * succeeds. `isPresent` gates `install` on either (a) the binary being
 * foregrounded in some terminal, or (b) `~/.codex` existing on disk
 * already (user has used Codex on this machine before). Neither holds
 * on a fresh machine that has never run Codex — no watcher, no logs,
 * no missing-directory error (issue #698).
 */

import fs from "node:fs";
import { type AgentAdapter, matchesAgent } from "anyagent";
import { CODEX_DIR } from "./config.ts";
import { type CodexSession, findSessionsByDirectory } from "./core.ts";
import type { CodexInfo } from "./schemas.ts";
import { createCodexWatcher } from "./session-watcher.ts";
import { subscribeCodexDb } from "./wal-watcher.ts";

/** The executable name this agent runs as — see `AgentAdapter.commandName`.
 *  Declared once here and used for BOTH the adapter's advertised identity and
 *  its own `matchesAgent` checks, so the two cannot drift. */
const AGENT_COMMAND = "codex";

export const codexAdapter: AgentAdapter<CodexSession, CodexInfo> = {
  kind: "codex",
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
    return createCodexWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, AGENT_COMMAND) || fs.existsSync(CODEX_DIR);
    },
    install(onChange, onError, log) {
      subscribeCodexDb(onChange, onError, log);
    },
  },
};
