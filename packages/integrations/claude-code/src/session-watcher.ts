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
import { agentInfoEqual } from "anyagent";
import {
  type SessionFile,
  type ClaudeCodeInfo,
  PROJECTS_DIR,
  TAIL_BYTES,
  encodeProjectPath,
  findTranscriptPath,
  tailJsonlLines,
  deriveState,
  extractTasks,
  deriveTaskProgress,
  watchOrWaitForDir,
  fetchSessionSummary,
} from "./index.ts";

// --- Tuning constants ---

/** Trailing-edge debounce for the transcript fs.watch callback. Claude
 *  streams tokens, and Linux fs.watch fires multiple events per write —
 *  without debouncing, `onTranscriptMaybeChanged` runs dozens to hundreds
 *  of times per second, each iteration re-allocating a 256 KB tail buffer
 *  and firing an async SDK summary fetch. 150 ms coalesces bursts into
 *  one handler run while keeping the user-perceptible lag imperceptible. */
const TRANSCRIPT_DEBOUNCE_MS = 150;

/** Chunk size for `scanTasksIncremental`. The previous one-shot
 *  `Buffer.alloc(size - offset)` could allocate hundreds of MB transiently
 *  on first attach to a pre-existing transcript, pushing a climbing heap
 *  over V8's 4 GB ceiling. 1 MB bounds peak transient memory regardless
 *  of file size. */
const TASK_SCAN_CHUNK_BYTES = 1024 * 1024;

// --- Transcript watching lifecycle ---

/** Transcript-watching state machine — mutually exclusive states. */
type TranscriptWatching =
  | { kind: "none" }
  | { kind: "waiting"; dirWatcher: () => void }
  | { kind: "watching"; path: string; fileWatcher: fs.FSWatcher };

// --- Logger interface ---

import type { Logger } from "anyagent";
export type { Logger as WatcherLog } from "anyagent";

// --- Diagnostics counter ---

/** Count of in-flight `fetchSessionSummary` calls across all SessionWatchers.
 *  Exposed via `getPendingSummaryFetches` for the server's diagnostics log.
 *
 *  Maintained by a try/finally pair inside `refreshSummary` so every
 *  completion path (resolve, reject, new error branch added later) is
 *  structurally guaranteed to decrement. Don't turn refreshSummary back
 *  into a .then/.catch pair or the pairing breaks.
 *
 *  Climbing unboundedly = backpressure: fs.watch on the Claude transcript
 *  is firing faster than getSessionInfo can respond, which is the shape
 *  of the leak we're trying to diagnose. */
let pendingSummaryFetches = 0;
export const getPendingSummaryFetches = (): number => pendingSummaryFetches;

// --- SessionWatcher ---

export interface SessionWatcher {
  readonly session: SessionFile;
  readonly destroy: () => void;
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
  plog: Logger,
): SessionWatcher {
  let transcriptWatching: TranscriptWatching = { kind: "none" };
  let lastInfo: ClaudeCodeInfo | null = null;
  let lastSummary: string | null = null;
  let taskMap = new Map<string, "pending" | "in_progress" | "completed">();
  let taskScanOffset = 0;
  // Partial final line from the previous chunked scan. Carried across
  // calls so a line straddling a chunk or EOF boundary resolves to a
  // single complete line once the newline arrives. Without this, the
  // tail of one call would be split-processed at the head of the next
  // call as if it were already a complete line — silent task corruption.
  let taskScanRemainder = "";
  // Trailing-edge debounce timer for transcript fs.watch events.
  // Null when idle. Cleared on destroy.
  let transcriptDebounceTimer: NodeJS.Timeout | null = null;

  let destroyed = false;

  function teardownTranscriptWatching() {
    match(transcriptWatching)
      .with({ kind: "none" }, () => {})
      .with({ kind: "waiting" }, ({ dirWatcher }) => dirWatcher())
      .with({ kind: "watching" }, ({ fileWatcher }) => fileWatcher.close())
      .exhaustive();
    transcriptWatching = { kind: "none" };
  }

  /** Trailing-edge debounce: reset the timer on every event, fire
   *  `onTranscriptMaybeChanged` once after `TRANSCRIPT_DEBOUNCE_MS` of
   *  quiet. The handler's own `destroyed` guard makes late-firing
   *  callbacks safe, but we clear the timer in `destroy()` anyway to
   *  avoid holding closure refs unnecessarily. */
  function scheduleTranscriptCheck() {
    if (destroyed) return;
    if (transcriptDebounceTimer) clearTimeout(transcriptDebounceTimer);
    transcriptDebounceTimer = setTimeout(() => {
      transcriptDebounceTimer = null;
      onTranscriptMaybeChanged();
    }, TRANSCRIPT_DEBOUNCE_MS);
  }

  function attachTranscriptWatcher(tp: string) {
    try {
      const fileWatcher = fs.watch(tp, () => scheduleTranscriptCheck());
      transcriptWatching = { kind: "watching", path: tp, fileWatcher };
    } catch (err) {
      plog.error({ err, path: tp }, "failed to watch transcript");
      transcriptWatching = { kind: "none" };
    }
  }

  function setupTranscriptWatching() {
    const tp = findTranscriptPath(session);
    if (tp) {
      plog.debug({ path: tp }, "transcript found");
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
    plog.debug({ path: tp }, "transcript appeared");
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
      contextTokens: derived.contextTokens,
    };

    if (!agentInfoEqual(info, lastInfo)) {
      plog.debug(
        { state: info.state, model: info.model, session: info.sessionId },
        "claude code state updated",
      );
      lastInfo = info;
      onUpdate(info);
    }

    refreshSummary();
  }

  /** Incrementally scan the transcript for TaskCreate/TaskUpdate entries.
   *
   *  Streams TASK_SCAN_CHUNK_BYTES at a time so peak transient memory is
   *  O(chunk) rather than O(file). Partial lines at chunk boundaries are
   *  accumulated into `taskScanRemainder` (persisted across calls) so
   *  straddling lines resolve correctly once their newline arrives.
   *
   *  `taskScanOffset` always advances to the full file size — the
   *  remainder lives separately, *not* in the unread region. On the next
   *  call, the remainder is prepended to the newly-written bytes, then
   *  split; the last (potentially partial) segment becomes the new
   *  remainder. */
  function scanTasksIncremental(filePath: string) {
    try {
      const size = fs.statSync(filePath).size;
      if (taskScanOffset >= size) return;
      const fd = fs.openSync(filePath, "r");
      const prevOffset = taskScanOffset;
      let carried = taskScanRemainder;
      let changed = false;
      try {
        let offset = taskScanOffset;
        while (offset < size) {
          const toRead = Math.min(TASK_SCAN_CHUNK_BYTES, size - offset);
          const buf = Buffer.alloc(toRead);
          fs.readSync(fd, buf, 0, toRead, offset);
          const text = carried + buf.toString("utf8");
          const lines = text.split("\n");
          // The last segment is either a complete line followed by a
          // trailing newline (→ "") or a partial line (→ the fragment).
          // Either way, carry it forward; never process it this round.
          carried = lines.pop() ?? "";
          const complete = lines.filter((l) => l.length > 0);
          if (complete.length > 0) {
            if (extractTasks(complete, taskMap, plog)) changed = true;
          }
          offset += toRead;
        }
      } finally {
        fs.closeSync(fd);
      }
      taskScanRemainder = carried;
      taskScanOffset = size;
      if (changed) {
        const progress = deriveTaskProgress(taskMap);
        plog.debug(
          {
            tasks: taskMap.size,
            progress,
            bytesScanned: size - prevOffset,
            from: prevOffset,
          },
          "task progress updated",
        );
      }
    } catch (err) {
      plog.error({ err, filePath, taskScanOffset }, "task scan failed");
    }
  }

  async function refreshSummary() {
    if (destroyed) return;
    pendingSummaryFetches++;
    try {
      const summary = await fetchSessionSummary(session.sessionId, session.cwd);
      if (destroyed) return;
      if (summary === lastSummary) return;
      lastSummary = summary;
      if (!lastInfo) return;
      plog.debug(
        { summary, session: session.sessionId },
        "claude summary updated",
      );
      const updated: ClaudeCodeInfo = { ...lastInfo, summary };
      lastInfo = updated;
      onUpdate(updated);
    } catch (err) {
      plog.debug({ err, session: session.sessionId }, "getSessionInfo failed");
    } finally {
      pendingSummaryFetches--;
    }
  }

  // --- Start watching ---
  setupTranscriptWatching();

  return {
    session,

    destroy() {
      destroyed = true;
      if (transcriptDebounceTimer) {
        clearTimeout(transcriptDebounceTimer);
        transcriptDebounceTimer = null;
      }
      teardownTranscriptWatching();
    },
  };
}
