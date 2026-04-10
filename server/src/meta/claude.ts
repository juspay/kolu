/**
 * Claude Code metadata provider — thin adapter that wires the
 * `kolu-claude-code` integration library into the server's metadata system.
 *
 * All Claude-specific logic (session reading, transcript tailing, state
 * derivation, task extraction) lives in `integrations/claude-code`.
 * This file owns the provider lifecycle: subscribing to events, managing
 * watcher state, and calling `updateMetadata`.
 *
 * Event-driven — no polling. Trigger sources:
 *   - title event (subscribeForTerminal("title", ...)) — fires on shell
 *     preexec/precmd OSC 2, which is when foregroundPid is likely to change
 *   - fs.watch(SESSIONS_DIR) — fires when session files appear/disappear
 *   - fs.watch(projectDir) — fires when the JSONL transcript is created
 *   - fs.watch(transcriptPath) — fires on each message, drives state updates
 */

import fs from "node:fs";
import { match } from "ts-pattern";
import type {
  AgentInfo,
  ClaudeCodeInfo,
  ClaudeStateChange,
  ClaudeTranscriptDebug,
  TaskProgress,
} from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { updateMetadata } from "./index.ts";
import { subscribeForTerminal } from "../publisher.ts";
import { log } from "../log.ts";

import {
  SESSIONS_DIR,
  PROJECTS_DIR,
  TAIL_BYTES,
  type SessionFile,
  readSessionFile,
  encodeProjectPath,
  findTranscriptPath,
  readJsonlFromOffset,
  tailJsonlLines,
  deriveState,
  extractTasks,
  deriveTaskProgress,
  tryWatchDir,
  watchOrWaitForDir,
  fetchSessionSummary,
} from "kolu-claude-code";

// --- Equality helpers ---

/** Compare two TaskProgress values for equality. */
function taskProgressEqual(
  a: TaskProgress | null,
  b: TaskProgress | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.total === b.total && a.completed === b.completed;
}

/** Compare two AgentInfo values for equality. */
export function infoEqual(a: AgentInfo | null, b: AgentInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.state !== b.state || a.sessionId !== b.sessionId) return false;
  if (a.kind === "claude-code" && b.kind === "claude-code") {
    return (
      a.model === b.model &&
      a.summary === b.summary &&
      taskProgressEqual(a.taskProgress, b.taskProgress)
    );
  }
  if (a.kind === "opencode" && b.kind === "opencode") {
    return a.model === b.model && a.summary === b.summary;
  }
  return true;
}

// --- Transcript watching lifecycle ---

/**
 * Transcript-watching lifecycle as a sum type — mutually exclusive states,
 * checked exhaustively via ts-pattern on every transition.
 *
 * The `watching` variant carries the diagnostic state used by the Debug
 * transcript command: `startOffset` anchors "events since kolu attached"
 * for the on-demand disk read, and `stateChanges` is an in-memory log of
 * every transition the server believed happened. Both vanish naturally
 * when the watcher tears down — no separate cleanup path to forget.
 */
type TranscriptWatching =
  | { kind: "none" }
  | { kind: "waiting"; dirWatcher: () => void }
  | {
      kind: "watching";
      path: string;
      fileWatcher: fs.FSWatcher;
      /** File size at watcher-attach time. Always at a JSONL line boundary. */
      startOffset: number;
      /** epoch ms when the watcher attached — start of monitoring. */
      startedAt: number;
      /** Mutated in place; defensive-copied on read by the accessor. */
      stateChanges: ClaudeStateChange[];
    };

/**
 * Start the Claude Code metadata provider for a terminal entry.
 * Wakes on title events + SESSIONS_DIR changes + transcript file changes.
 */
export function startClaudeCodeProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "claude-code", terminal: terminalId });

  let matchedSession: SessionFile | null = null;
  let transcriptWatching: TranscriptWatching = { kind: "none" };
  let lastSummary: string | null = null;
  let taskMap = new Map<string, "pending" | "in_progress" | "completed">();
  let taskScanOffset = 0;

  plog.info("started");

  function teardownTranscriptWatching() {
    match(transcriptWatching)
      .with({ kind: "none" }, () => {})
      .with({ kind: "waiting" }, ({ dirWatcher }) => dirWatcher())
      .with({ kind: "watching" }, ({ fileWatcher }) => fileWatcher.close())
      .exhaustive();
    transcriptWatching = { kind: "none" };
  }

  function attachTranscriptWatcher(tp: string) {
    try {
      const fileWatcher = fs.watch(tp, () => onTranscriptMaybeChanged());
      const startOffset = fs.statSync(tp).size;
      transcriptWatching = {
        kind: "watching",
        path: tp,
        fileWatcher,
        startOffset,
        startedAt: Date.now(),
        stateChanges: [],
      };
    } catch (err) {
      plog.warn({ err, path: tp }, "failed to watch transcript");
      transcriptWatching = { kind: "none" };
    }
  }

  function setupTranscriptWatching(session: SessionFile) {
    const tp = findTranscriptPath(session);
    if (tp) {
      plog.info({ path: tp }, "transcript found");
      attachTranscriptWatcher(tp);
      onTranscriptMaybeChanged();
      return;
    }
    plog.debug(
      { session: session.sessionId, cwd: session.cwd },
      "transcript not found yet (JSONL created after first message)",
    );
    const projectDir = PROJECTS_DIR + "/" + encodeProjectPath(session.cwd);
    const dirWatcher = watchOrWaitForDir(projectDir, () =>
      onProjectDirChanged(),
    );
    transcriptWatching = { kind: "waiting", dirWatcher };
  }

  function onProjectDirChanged() {
    if (!matchedSession) return;
    if (transcriptWatching.kind !== "waiting") return;
    const tp = findTranscriptPath(matchedSession);
    if (!tp) return;
    plog.info({ path: tp }, "transcript appeared");
    transcriptWatching.dirWatcher();
    attachTranscriptWatcher(tp);
    onTranscriptMaybeChanged();
  }

  function onTranscriptMaybeChanged() {
    if (transcriptWatching.kind !== "watching") return;
    if (!matchedSession) return;

    const lines = tailJsonlLines(transcriptWatching.path, TAIL_BYTES);
    const derived = deriveState(lines);
    if (!derived) {
      plog.debug(
        { path: transcriptWatching.path },
        "no user/assistant message in transcript tail",
      );
      return;
    }

    // Incrementally scan new transcript bytes for task tool calls.
    scanTasksIncremental(transcriptWatching.path);

    const info: ClaudeCodeInfo = {
      kind: "claude-code",
      state: derived.state,
      sessionId: matchedSession.sessionId,
      model: derived.model,
      summary: lastSummary,
      taskProgress: deriveTaskProgress(taskMap),
    };

    if (!infoEqual(info, entry.info.meta.agent)) {
      plog.info(
        { state: info.state, model: info.model, session: info.sessionId },
        "claude code state updated",
      );
      transcriptWatching.stateChanges.push({ ts: Date.now(), info });
      updateMetadata(entry, terminalId, (m) => {
        m.agent = info;
      });
    }

    refreshSummary(matchedSession);
  }

  function scanTasksIncremental(filePath: string) {
    try {
      const size = fs.statSync(filePath).size;
      if (taskScanOffset >= size) return;
      const length = size - taskScanOffset;
      const fd = fs.openSync(filePath, "r");
      let buf: Buffer;
      try {
        buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, taskScanOffset);
      } finally {
        fs.closeSync(fd);
      }
      const newLines = buf
        .toString("utf8")
        .split("\n")
        .filter((l) => l.length > 0);
      if (taskScanOffset > 0 && newLines.length > 0) {
        try {
          JSON.parse(newLines[0]!);
        } catch {
          newLines.shift();
        }
      }
      const prevOffset = taskScanOffset;
      taskScanOffset = size;
      const changed = extractTasks(newLines, taskMap, plog);
      if (changed) {
        const progress = deriveTaskProgress(taskMap);
        plog.info(
          {
            tasks: taskMap.size,
            progress,
            bytesScanned: length,
            from: prevOffset,
          },
          "task progress updated",
        );
      }
    } catch (err) {
      plog.warn({ err, filePath, taskScanOffset }, "task scan failed");
    }
  }

  function refreshSummary(session: SessionFile) {
    fetchSessionSummary(session.sessionId, session.cwd)
      .then((summary) => {
        if (matchedSession?.sessionId !== session.sessionId) return;
        if (summary === lastSummary) return;
        lastSummary = summary;
        const current = entry.info.meta.agent;
        if (!current || current.kind !== "claude-code") return;
        plog.info(
          { summary, session: session.sessionId },
          "claude summary updated",
        );
        updateMetadata(entry, terminalId, (m) => {
          m.agent = { ...current, summary };
        });
      })
      .catch((err) => {
        plog.debug(
          { err, session: session.sessionId },
          "getSessionInfo failed",
        );
      });
  }

  function onSessionMaybeChanged() {
    const fgPid = entry.handle.foregroundPid;
    const newSession =
      fgPid !== undefined ? readSessionFile(fgPid, plog) : null;

    if (
      (matchedSession?.sessionId ?? null) === (newSession?.sessionId ?? null)
    ) {
      return;
    }

    teardownTranscriptWatching();
    matchedSession = newSession;
    lastSummary = null;
    taskMap = new Map();
    taskScanOffset = 0;

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
    setupTranscriptWatching(newSession);
  }

  // Debug accessor for the `claude.getTranscript` RPC.
  entry.getClaudeDebug = (): ClaudeTranscriptDebug | null => {
    if (transcriptWatching.kind !== "watching") return null;
    const {
      path: tp,
      startOffset,
      startedAt,
      stateChanges,
    } = transcriptWatching;
    return {
      transcriptPath: tp,
      startedAt,
      stateChanges: [...stateChanges],
      rawEvents: readJsonlFromOffset(tp, startOffset),
    };
  };

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
    teardownTranscriptWatching();
    delete entry.getClaudeDebug;
    plog.info("stopped");
  };
}
