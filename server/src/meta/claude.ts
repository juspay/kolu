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

// --- Shared SESSIONS_DIR watcher ---
//
// Every claude provider wants to know when `~/.claude/sessions/` changes.
// The pre-sharing implementation installed one `fs.watch` per terminal,
// so N terminals meant N independent inotify watches on the same
// directory and N duplicate callback dispatches per file event. This
// module-level singleton refcounts a single watcher: first subscriber
// lazily installs it, last unsubscribe tears it down.
//
// `sharedSessionsDir` is a single nullable structure rather than a
// {watcher, listeners} pair so the "active iff non-empty" invariant is
// mechanical — there's no way for the two halves to disagree.
//
// Per-listener try/catch inside the iteration preserves the pre-sharing
// fault isolation: one provider's callback throwing does not drop the
// event for every subsequent provider.

let sharedSessionsDir: {
  cleanup: () => void;
  listeners: Set<() => void>;
} | null = null;

function subscribeSessionsDir(cb: () => void): () => void {
  if (!sharedSessionsDir) {
    const listeners = new Set<() => void>();
    const cleanup = watchOrWaitForDir(SESSIONS_DIR, () => {
      // Snapshot before iteration so a listener that synchronously
      // subscribes/unsubscribes can't skip a peer for this event. Today
      // `onSessionMaybeChanged` does neither, but the guard is cheap
      // and eliminates a future-footgun shape.
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch (err) {
          log.warn({ err }, "sessions-dir listener threw");
        }
      }
    });
    sharedSessionsDir = { cleanup, listeners };
  }
  sharedSessionsDir.listeners.add(cb);
  return () => {
    if (!sharedSessionsDir) return;
    sharedSessionsDir.listeners.delete(cb);
    if (sharedSessionsDir.listeners.size === 0) {
      sharedSessionsDir.cleanup();
      sharedSessionsDir = null;
    }
  };
}

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
    delete entry.getClaudeDebug;

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

    entry.getClaudeDebug = () => current?.getDebug() ?? null;
  }

  // Subscribe to title events — each shell preexec/precmd OSC 2 fires here.
  const abort = new AbortController();
  subscribeForTerminal("title", terminalId, abort.signal, () =>
    onSessionMaybeChanged(),
  );

  // Subscribe to the shared sessions-dir watcher (one inotify watch
  // process-wide, regardless of terminal count). See subscribeSessionsDir.
  const unsubscribeSessionsDir = subscribeSessionsDir(() =>
    onSessionMaybeChanged(),
  );

  // Initial reconcile for a terminal that already hosts a claude session.
  onSessionMaybeChanged();

  return () => {
    abort.abort();
    unsubscribeSessionsDir();
    current?.destroy();
    delete entry.getClaudeDebug;
    plog.debug("stopped");
  };
}
