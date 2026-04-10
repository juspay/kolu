/**
 * Claude Code metadata provider — thin adapter that wires the
 * `kolu-claude-code` integration library into the server's metadata system.
 *
 * All per-session lifecycle (transcript watching, state derivation, task
 * scanning, summary fetching) lives in `SessionWatcher` from the
 * integration library. This file owns only session matching (correlating
 * foreground PID to a Claude session file) and event wiring.
 */

import type { AgentInfo } from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { updateMetadata } from "./index.ts";
import { subscribeForTerminal } from "../publisher.ts";
import { log } from "../log.ts";

import {
  SESSIONS_DIR,
  readSessionFile,
  watchOrWaitForDir,
  createSessionWatcher,
  infoEqual as claudeInfoEqual,
  type SessionWatcher,
} from "kolu-claude-code";

/** Compare two AgentInfo values for equality. */
export function infoEqual(a: AgentInfo | null, b: AgentInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "claude-code" && b.kind === "claude-code") {
    return claudeInfoEqual(a, b);
  }
  if (a.kind === "opencode" && b.kind === "opencode") {
    return (
      a.state === b.state &&
      a.sessionId === b.sessionId &&
      a.model === b.model &&
      a.summary === b.summary
    );
  }
  return true;
}

/**
 * Start the Claude Code metadata provider for a terminal entry.
 * Wakes on title events + SESSIONS_DIR changes to detect sessions.
 * Delegates all per-session lifecycle to SessionWatcher.
 */
export function startClaudeCodeProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "claude-code", terminal: terminalId });

  let current: SessionWatcher | null = null;

  plog.info("started");

  function onSessionMaybeChanged() {
    const fgPid = entry.handle.foregroundPid;
    const newSession =
      fgPid !== undefined ? readSessionFile(fgPid, plog) : null;

    if (
      (current?.session.sessionId ?? null) === (newSession?.sessionId ?? null)
    ) {
      return;
    }

    // Tear down previous session watcher.
    current?.destroy();
    current = null;
    delete entry.getClaudeDebug;

    if (!newSession) {
      plog.info("claude code session ended");
      if (entry.info.meta.agent !== null) {
        updateMetadata(entry, terminalId, (m) => {
          m.agent = null;
        });
      }
      return;
    }

    plog.info(
      { session: newSession.sessionId, pid: newSession.pid },
      "claude code session matched",
    );

    current = createSessionWatcher(
      newSession,
      (info) => {
        updateMetadata(entry, terminalId, (m) => {
          m.agent = info;
        });
      },
      plog,
    );

    entry.getClaudeDebug = () => current?.getDebug() ?? null;
  }

  // Subscribe to title events — each shell preexec/precmd OSC 2 fires here.
  const abort = new AbortController();
  subscribeForTerminal("title", terminalId, abort.signal, () =>
    onSessionMaybeChanged(),
  );

  // Watch the sessions dir for session file appearance/disappearance.
  const sessionsDirWatcher = watchOrWaitForDir(SESSIONS_DIR, () =>
    onSessionMaybeChanged(),
  );

  // Initial reconcile for a terminal that already hosts a claude session.
  onSessionMaybeChanged();

  return () => {
    abort.abort();
    sessionsDirWatcher();
    current?.destroy();
    delete entry.getClaudeDebug;
    plog.info("stopped");
  };
}
