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
  readSessionFile,
  subscribeSessionsDir,
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
  return a.state === b.state && a.sessionId === b.sessionId;
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

  plog.debug("started");

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

    if (!newSession) {
      plog.debug("claude code session ended");
      if (entry.info.meta.agent !== null) {
        updateMetadata(entry, terminalId, (m) => {
          m.agent = null;
        });
      }
      return;
    }

    plog.debug(
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
  }

  // Subscribe to title events — each shell preexec/precmd OSC 2 fires here.
  const abort = new AbortController();
  subscribeForTerminal("title", terminalId, abort.signal, () =>
    onSessionMaybeChanged(),
  );

  // Subscribe to the shared sessions-dir watcher (one inotify watch
  // process-wide, regardless of terminal count). Implemented in the
  // kolu-claude-code integration package so the server doesn't need
  // to know SESSIONS_DIR exists.
  const unsubscribeSessionsDir = subscribeSessionsDir(
    () => onSessionMaybeChanged(),
    (err) => plog.warn({ err }, "sessions-dir listener threw"),
  );

  // Initial reconcile for a terminal that already hosts a claude session.
  onSessionMaybeChanged();

  return () => {
    abort.abort();
    unsubscribeSessionsDir();
    current?.destroy();

    plog.debug("stopped");
  };
}
