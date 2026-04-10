/**
 * SessionWatcher — encapsulates all per-session lifecycle state.
 *
 * Creating a SessionWatcher starts transcript watching, task scanning,
 * and summary fetching. Destroying it tears everything down. No "remember
 * to reset N variables" invariant — the lifetime IS the object.
 *
 * The server's claude provider creates one of these per matched session
 * and replaces it on session change.
 */

import fs from "node:fs";
import { match } from "ts-pattern";
import {
  type SessionFile,
  type ClaudeCodeInfo,
  type TaskProgress,
  PROJECTS_DIR,
  TAIL_BYTES,
  encodeProjectPath,
  findTranscriptPath,
  tailJsonlLines,
  readJsonlFromOffset,
  deriveState,
  extractTasks,
  deriveTaskProgress,
  watchOrWaitForDir,
  fetchSessionSummary,
} from "./index.ts";

// --- Debug types ---
// Structurally identical to the Zod-inferred types from the schemas
// in index.ts. Defined as interfaces here to avoid a circular import
// (index.ts re-exports from this module).

export interface ClaudeStateChange {
  ts: number;
  info: ClaudeCodeInfo | null;
}

export interface ClaudeTranscriptDebug {
  transcriptPath: string;
  startedAt: number;
  stateChanges: ClaudeStateChange[];
  rawEvents: unknown[];
}

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

/** Compare two ClaudeCodeInfo values for equality. */
export function infoEqual(
  a: ClaudeCodeInfo | null,
  b: ClaudeCodeInfo | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.state === b.state &&
    a.sessionId === b.sessionId &&
    a.model === b.model &&
    a.summary === b.summary &&
    taskProgressEqual(a.taskProgress, b.taskProgress)
  );
}

// --- Transcript watching lifecycle ---

/**
 * Transcript-watching state machine — mutually exclusive states.
 * Diagnostic state (stateChanges, startOffset) lives alongside the
 * watcher, not embedded in the union — it shares the SessionWatcher
 * lifetime, not the transcript-attach lifecycle.
 */
type TranscriptWatching =
  | { kind: "none" }
  | { kind: "waiting"; dirWatcher: () => void }
  | { kind: "watching"; path: string; fileWatcher: fs.FSWatcher };

// --- Logger interface ---

export interface WatcherLog {
  info: (obj: Record<string, unknown>, msg: string) => void;
  debug: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

// --- SessionWatcher ---

export interface SessionWatcher {
  readonly session: SessionFile;
  readonly destroy: () => void;
  readonly getDebug: () => ClaudeTranscriptDebug | null;
}

/**
 * Create a SessionWatcher for a matched Claude Code session.
 *
 * Starts transcript watching, incremental task scanning, and summary
 * fetching. Calls `onUpdate` whenever the derived ClaudeCodeInfo changes
 * (change-gated via `infoEqual`).
 *
 * Call `destroy()` to tear everything down.
 */
export function createSessionWatcher(
  session: SessionFile,
  onUpdate: (info: ClaudeCodeInfo) => void,
  plog: WatcherLog,
): SessionWatcher {
  let transcriptWatching: TranscriptWatching = { kind: "none" };
  let lastInfo: ClaudeCodeInfo | null = null;
  let lastSummary: string | null = null;
  let taskMap = new Map<string, "pending" | "in_progress" | "completed">();
  let taskScanOffset = 0;

  // Diagnostic state — shares the SessionWatcher lifetime.
  let debugStartOffset = 0;
  let debugStartedAt = 0;
  const stateChanges: ClaudeStateChange[] = [];

  let destroyed = false;

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
      transcriptWatching = { kind: "watching", path: tp, fileWatcher };
      debugStartOffset = fs.statSync(tp).size;
      debugStartedAt = Date.now();
    } catch (err) {
      plog.warn({ err, path: tp }, "failed to watch transcript");
      transcriptWatching = { kind: "none" };
    }
  }

  function setupTranscriptWatching() {
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
    if (destroyed) return;
    if (transcriptWatching.kind !== "waiting") return;
    const tp = findTranscriptPath(session);
    if (!tp) return;
    plog.info({ path: tp }, "transcript appeared");
    transcriptWatching.dirWatcher();
    attachTranscriptWatcher(tp);
    onTranscriptMaybeChanged();
  }

  function onTranscriptMaybeChanged() {
    if (destroyed) return;
    if (transcriptWatching.kind !== "watching") return;

    const lines = tailJsonlLines(transcriptWatching.path, TAIL_BYTES);
    const derived = deriveState(lines);
    if (!derived) {
      plog.debug(
        { path: transcriptWatching.path },
        "no user/assistant message in transcript tail",
      );
      return;
    }

    scanTasksIncremental(transcriptWatching.path);

    const info: ClaudeCodeInfo = {
      kind: "claude-code",
      state: derived.state,
      sessionId: session.sessionId,
      model: derived.model,
      summary: lastSummary,
      taskProgress: deriveTaskProgress(taskMap),
    };

    if (!infoEqual(info, lastInfo)) {
      plog.info(
        { state: info.state, model: info.model, session: info.sessionId },
        "claude code state updated",
      );
      lastInfo = info;
      stateChanges.push({ ts: Date.now(), info });
      onUpdate(info);
    }

    refreshSummary();
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
      // First line may be partial when reading from a mid-file offset — safe to drop.
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

  function refreshSummary() {
    if (destroyed) return;
    fetchSessionSummary(session.sessionId, session.cwd)
      .then((summary) => {
        if (destroyed) return;
        if (summary === lastSummary) return;
        lastSummary = summary;
        if (!lastInfo) return;
        plog.info(
          { summary, session: session.sessionId },
          "claude summary updated",
        );
        const updated: ClaudeCodeInfo = { ...lastInfo, summary };
        lastInfo = updated;
        onUpdate(updated);
      })
      .catch((err) => {
        plog.debug(
          { err, session: session.sessionId },
          "getSessionInfo failed",
        );
      });
  }

  // --- Start watching ---
  setupTranscriptWatching();

  return {
    session,

    destroy() {
      destroyed = true;
      teardownTranscriptWatching();
    },

    getDebug(): ClaudeTranscriptDebug | null {
      if (transcriptWatching.kind !== "watching") return null;
      return {
        transcriptPath: transcriptWatching.path,
        startedAt: debugStartedAt,
        stateChanges: [...stateChanges],
        rawEvents: readJsonlFromOffset(
          transcriptWatching.path,
          debugStartOffset,
        ),
      };
    },
  };
}
