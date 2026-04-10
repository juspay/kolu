/**
 * OpenCode metadata provider — thin adapter that wires the
 * `kolu-opencode` integration library into the server's metadata system.
 *
 * All OpenCode-specific logic (DB queries, state derivation) lives in
 * `integrations/opencode`. This file owns the provider lifecycle:
 * subscribing to events, managing watcher state, and calling
 * `updateMetadata`.
 *
 * Event-driven — no polling. Trigger sources:
 *   - title event (subscribeForTerminal("title", ...)) — fires on shell
 *     preexec/precmd OSC 2, when the foreground process may have changed
 *   - fs.watch on opencode.db-wal — fires when OpenCode writes to its DB
 *
 * Detection: when the foreground process basename is "opencode", we look up
 * the most recently updated session in OpenCode's SQLite DB whose `directory`
 * matches the terminal's CWD, then re-derive state on each WAL file change.
 */

import path from "node:path";
import type { OpenCodeInfo } from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { updateMetadata } from "./index.ts";
import { infoEqual } from "./claude.ts";
import { subscribeForTerminal } from "../publisher.ts";
import { log } from "../log.ts";

import {
  findSessionByDirectory,
  deriveSessionState,
  watchOpenCodeDb,
  type OpenCodeSession,
} from "kolu-opencode";

/**
 * Start the OpenCode metadata provider for a terminal entry.
 * Wakes on title events (foreground process change) and on OpenCode
 * database writes (fs.watch on the WAL file).
 */
export function startOpenCodeProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "opencode", terminal: terminalId });

  let matchedSession: OpenCodeSession | null = null;
  let dbWatcher: (() => void) | null = null;

  plog.info("started");

  /**
   * Read the foreground process basename directly from node-pty.
   * Don't use entry.info.meta.foreground — it's set by the process provider,
   * which may not have run yet on the initial check or may not run before
   * us on a title event (subscriber order is not deterministic).
   */
  function currentForegroundName(): string | null {
    try {
      const proc = entry.handle.process;
      return proc ? path.basename(proc) : null;
    } catch (err) {
      plog.debug({ err }, "failed to read entry.handle.process");
      return null;
    }
  }

  function teardownDbWatcher() {
    if (dbWatcher) {
      dbWatcher();
      dbWatcher = null;
    }
  }

  function publishCleared() {
    if (entry.info.meta.agent?.kind === "opencode") {
      updateMetadata(entry, terminalId, (m) => {
        m.agent = null;
      });
    }
  }

  /** Re-derive state for the matched session and publish if changed. */
  function refreshState() {
    if (!matchedSession) return;
    const derived = deriveSessionState(matchedSession.id, plog);
    if (!derived) {
      plog.debug(
        { session: matchedSession.id },
        "no messages yet for opencode session",
      );
      return;
    }

    const info: OpenCodeInfo = {
      kind: "opencode",
      state: derived.state,
      sessionId: matchedSession.id,
      model: derived.model,
      summary: matchedSession.title,
    };

    if (!infoEqual(entry.info.meta.agent, info)) {
      plog.info(
        { state: info.state, model: info.model, session: info.sessionId },
        "opencode state updated",
      );
      updateMetadata(entry, terminalId, (m) => {
        m.agent = info;
      });
    }
  }

  /** Called when the foreground process or session may have changed. */
  function onForegroundMaybeChanged() {
    const name = currentForegroundName();
    const isOpenCode = name === "opencode";

    if (!isOpenCode) {
      if (matchedSession) {
        plog.info(
          { from: matchedSession.id, to: name },
          "opencode no longer foreground",
        );
        teardownDbWatcher();
        matchedSession = null;
        publishCleared();
      }
      return;
    }

    // Look up the most recently updated session for this terminal's CWD
    const cwd = entry.info.meta.cwd;
    const session = findSessionByDirectory(cwd, plog);

    if (!session) {
      plog.debug({ cwd }, "no opencode session for this directory");
      return;
    }

    // New session match (or first time) — set up the watcher
    if (!matchedSession || matchedSession.id !== session.id) {
      plog.info(
        { session: session.id, title: session.title, cwd },
        "opencode session matched",
      );
      teardownDbWatcher();
      matchedSession = session;
      dbWatcher = watchOpenCodeDb(() => refreshState(), plog);
    }

    refreshState();
  }

  // Subscribe to title events — fires on shell OSC 2 / preexec.
  const titleAbort = new AbortController();
  subscribeForTerminal("title", terminalId, titleAbort.signal, () =>
    onForegroundMaybeChanged(),
  );

  // Initial check — covers terminals that already host opencode at startup.
  onForegroundMaybeChanged();

  return () => {
    titleAbort.abort();
    teardownDbWatcher();
    plog.info("stopped");
  };
}
