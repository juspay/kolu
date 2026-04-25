/**
 * Codex's AgentProvider — wires the package's existing helpers
 * (`findSessionByDirectory`, `createCodexWatcher`, `subscribeCodexDb`)
 * into the shared `AgentProvider<Session, Info>` contract from anyagent.
 *
 * `externalChanges` IS implemented here — unlike OpenCode, Codex can
 * have a running `codex` TUI process whose thread row doesn't exist in
 * SQLite until the first exchange completes. A bare title event won't
 * fire at that moment, so we also rewake on every WAL write and let
 * `resolveSession` re-check the DB. When the thread appears, match
 * succeeds. `isPresent` gates `install` on either (a) the binary being
 * foregrounded in some terminal, or (b) `~/.codex` existing on disk
 * already (user has used Codex on this machine before). Neither holds
 * on a fresh machine that has never run Codex — no watcher, no logs,
 * no missing-directory error (issue #698).
 */

import fs from "node:fs";
import { type AgentProvider, matchesAgent } from "anyagent";
import { CODEX_DIR } from "./config.ts";
import type { CodexInfo, CodexSession } from "./index.ts";
import { findSessionByDirectory } from "./index.ts";
import { createCodexWatcher } from "./session-watcher.ts";
import { subscribeCodexDb } from "./wal-watcher.ts";

export const codexProvider: AgentProvider<CodexSession, CodexInfo> = {
  kind: "codex",

  resolveSession(state, log) {
    if (!matchesAgent(state, "codex")) return null;
    return findSessionByDirectory(state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  createWatcher(session, onChange, log) {
    return createCodexWatcher(session, onChange, log);
  },

  externalChanges: {
    isPresent(state) {
      return matchesAgent(state, "codex") || fs.existsSync(CODEX_DIR);
    },
    install(onChange, onError, log) {
      subscribeCodexDb(onChange, onError, log);
    },
  },
};
