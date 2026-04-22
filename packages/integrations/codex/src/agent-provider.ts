/**
 * Codex's AgentProvider — wires the package's existing helpers
 * (`findSessionByDirectory`, `createCodexWatcher`) into the shared
 * `AgentProvider<Session, Info>` contract from anyagent.
 *
 * `subscribeExternalChanges` is intentionally omitted: Codex's TUI
 * process owns its session throughout its lifetime, and the session only
 * appears in the database *after* the first user exchange — but by then
 * a title event has already fired, so re-resolving on title covers the
 * appearance case. WAL changes are per-session state, owned by
 * `createCodexWatcher`, not session-identity changes.
 */

import type { AgentProvider } from "anyagent";
import { findSessionByDirectory } from "./index.ts";
import { createCodexWatcher } from "./session-watcher.ts";
import type { CodexSession, CodexInfo } from "./index.ts";

export const codexProvider: AgentProvider<CodexSession, CodexInfo> = {
  kind: "codex",

  resolveSession(state, log) {
    if (state.readForegroundBasename() !== "codex") return null;
    return findSessionByDirectory(state.cwd, log);
  },

  sessionKey(session) {
    return session.id;
  },

  createWatcher(session, onChange, log) {
    return createCodexWatcher(session, onChange, log);
  },

  // subscribeExternalChanges: intentionally omitted.
};
