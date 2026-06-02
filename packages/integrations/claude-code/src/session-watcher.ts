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
import { agentInfoEqual } from "anyagent";
import { match } from "ts-pattern";
import {
  decayTransientState,
  deriveState,
  deriveTaskProgress,
  deriveWorkflowProgress,
  encodeProjectPath,
  extractTasks,
  fetchSessionSummary,
  findTranscriptPath,
  isClaudeSubtreeIdle,
  liveOutstandingTasks,
  nextWorkflowStaleDeadline,
  observeWorkflowRun,
  outstandingBackgroundTasks,
  PROJECTS_DIR,
  type SessionFile,
  type WorkflowObservation,
  TAIL_BYTES,
  tailJsonlLines,
  watchOrWaitForDir,
  workflowsDirFor,
} from "./core.ts";
import type { ClaudeCodeInfo, ClaudeWorkflow } from "./schemas.ts";

/** Change-gate for `ClaudeCodeInfo`. `agentInfoEqual` only compares the
 *  shared AgentInfo shape (state, model, summary, tokens, taskProgress); the
 *  Claude-only `workflow` field rides alongside, so its updates (e.g. the
 *  fan-out `agents` count climbing) would be dropped without comparing it
 *  here. Kept in this package rather than forking the shared comparator —
 *  the shared comparator stays integration-agnostic by design.
 *
 *  Maintenance contract: every Claude-specific field added to
 *  `ClaudeCodeInfo` beyond the shared shape MUST be compared here too, or its
 *  updates are silently dropped by the change gate (stale watcher state, no
 *  error). `workflow` is the first such field. */
function claudeInfoEqual(
  a: ClaudeCodeInfo | null,
  b: ClaudeCodeInfo | null,
): boolean {
  return agentInfoEqual(a, b) && workflowEqual(a?.workflow, b?.workflow);
}

function workflowEqual(
  a: ClaudeWorkflow | null | undefined,
  b: ClaudeWorkflow | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.name === b.name && a.status === b.status && a.agents === b.agents;
}

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

import type { Logger } from "kolu-shared";

export type { Logger as WatcherLog } from "kolu-shared";

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
  const taskMap = new Map<string, "pending" | "in_progress" | "completed">();
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
  // One-shot timer armed at the next workflow-journal stale deadline while
  // `running_background` is published. A journal going stale produces no
  // fs.watch event (it's the *absence* of writes), so without this the phantom
  // spinner would never self-clear if the agent dies on a still-fresh journal.
  // Re-armed on every check, cleared on destroy.
  let staleDeadlineTimer: NodeJS.Timeout | null = null;
  // Watcher over the per-session `workflows/` dir (completion snapshots).
  // Snapshots land while the agent is busy-waiting and the transcript is
  // otherwise quiet, so this keeps the fan-out count live. Null until set up.
  let workflowsDirWatcher: (() => void) | null = null;

  let destroyed = false;

  function teardownTranscriptWatching() {
    match(transcriptWatching)
      .with({ kind: "none" }, () => {})
      .with({ kind: "waiting" }, ({ dirWatcher }) => dirWatcher())
      .with({ kind: "watching" }, ({ path, fileWatcher }) => {
        fileWatcher.close();
        plog.info(
          { path, session: session.sessionId },
          "claude-code: transcript watcher retired",
        );
      })
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

  /** Arm (or clear) the one-shot timer that re-runs the derivation when a
   *  workflow journal crosses its stale threshold. Called on every check: while
   *  `running_background`, point it at the soonest live-journal deadline so the
   *  spinner self-clears even if the agent dies and no further fs event fires;
   *  otherwise leave it disarmed. A fresh `setTimeout` per check replaces any
   *  prior one, so the deadline always tracks the latest journal mtime. */
  function scheduleStaleRecheck(deadline: number | null) {
    if (staleDeadlineTimer) {
      clearTimeout(staleDeadlineTimer);
      staleDeadlineTimer = null;
    }
    if (destroyed || deadline === null) return;
    // +1ms so the timer fires strictly past the threshold the recheck tests
    // with `>` (a fire exactly at the deadline would still read as fresh).
    const delay = Math.max(0, deadline - Date.now()) + 1;
    staleDeadlineTimer = setTimeout(() => {
      staleDeadlineTimer = null;
      onTranscriptMaybeChanged();
    }, delay);
  }

  function attachTranscriptWatcher(tp: string) {
    try {
      const fileWatcher = fs.watch(tp, () => scheduleTranscriptCheck());
      transcriptWatching = { kind: "watching", path: tp, fileWatcher };
      plog.info(
        { path: tp, session: session.sessionId },
        "claude-code: transcript watcher installed",
      );
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
    const projectDir = `${PROJECTS_DIR}/${encodeProjectPath(session.cwd)}`;
    const dirWatcher = watchOrWaitForDir(
      projectDir,
      () => onProjectDirChanged(),
      plog,
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

  /** Milliseconds since the transcript was last written, measured against the
   *  caller's `now` clock sample, or null when it can't be stat-ed — treated as
   *  "unknown", so no transient de-escalation fires (never clear a pill on a
   *  stat failure). Sharing `now` with `decayTransientState` keeps the quiet
   *  window and the re-derived recheck instant on a single clock read. */
  function transcriptQuietMs(filePath: string, now: number): number | null {
    try {
      return now - fs.statSync(filePath).mtimeMs;
    } catch {
      return null;
    }
  }

  /** Whether the trailing prompt belongs to a killed instance the current
   *  (resumed) claude never processed: its timestamp predates the session's
   *  `startedAt`. `promptMs` is the timestamp `deriveState` read for state, so
   *  the age check and the state share one walk. False when either timestamp is
   *  unknown — so a live turn, or a session file without `startedAt`, is never
   *  treated as orphaned. */
  function isTrailingPromptOrphaned(
    promptMs: number | null,
    startedAt: number | undefined,
  ): boolean {
    if (startedAt === undefined) return false;
    return promptMs !== null && promptMs < startedAt;
  }

  function onTranscriptMaybeChanged() {
    if (destroyed) return;
    if (transcriptWatching.kind !== "watching") return;

    const lines = tailJsonlLines(transcriptWatching.path, TAIL_BYTES);
    // observeWorkflowRun is the single source of truth; the three projections
    // below (liveOutstandingTasks / nextWorkflowStaleDeadline /
    // deriveWorkflowProgress) all read its result. Observe each distinct runId
    // ONCE per check pass and memoize into this Map — each observation is now a
    // readdir + N stats over the live streaming dir (#1123), so re-observing the
    // same run three times would walk disk 3× per pass, scaling with sub-agent
    // count. The `observe` lookup hands the same observation to every projection.
    const obs = new Map<string, WorkflowObservation>();
    const observe = (runId: string): WorkflowObservation => {
      let o = obs.get(runId);
      if (o === undefined) {
        o = observeWorkflowRun(session, runId);
        obs.set(runId, o);
      }
      return o;
    };
    // Drop tasks that can't keep the session "working": a `Workflow` whose
    // journal has gone terminal/stale (orphaned by a restart). `deriveState`
    // further narrows to runId-bearing `Workflow` runs, so a bare backgrounded
    // Bash/Agent never promotes. Together: only a live, observable workflow
    // keeps `running_background`.
    const outstanding = liveOutstandingTasks(
      session,
      outstandingBackgroundTasks(lines),
      Date.now(),
      observe,
    );
    const derived = deriveState(lines, outstanding);
    if (!derived) {
      plog.debug(
        { path: transcriptWatching.path },
        "no user/assistant message in transcript tail",
      );
      return;
    }

    // Resolve the state to publish and when (if ever) to re-probe. Two
    // staleness-driven de-escalations live here, on disjoint states — a quiet
    // transcript / journal fires no fs event, so each arms the reused one-shot
    // recheck timer that re-derives without an external trigger:
    //   - running_background (#1109): demote once the workflow journal goes
    //     stale; the deadline tracks the soonest live-journal stale time.
    //   - dangling tool_use (#1017): demote to `waiting` once the transcript is
    //     quiet past the window AND claude's subtree is idle (no descendant
    //     process). A genuine long tool keeps a child, so it is never cleared.
    //   - thinking (#1017): a trailing `user` prompt is childless and quiet
    //     whether the turn is live or abandoned, so demote only when the prompt
    //     is ORPHANED — it predates this claude's `startedAt`, i.e. it belongs
    //     to a killed instance and the current (resumed) claude never processed
    //     it. A live turn's prompt postdates `startedAt`, so it is never cleared.
    //     The subtree is NOT consulted here (unlike tool_use): a resumed-idle
    //     claude often holds a long-lived MCP/helper child, which would wrongly
    //     read as "busy" — orphaned + stale is already definitive.
    let publishedState = derived.state;
    let staleDeadline: number | null = null;
    if (derived.state === "running_background") {
      staleDeadline = nextWorkflowStaleDeadline(
        session,
        outstanding,
        Date.now(),
        observe,
      );
    } else {
      const now = Date.now();
      const quietMs = transcriptQuietMs(transcriptWatching.path, now);
      if (quietMs !== null) {
        const decayed = decayTransientState(
          derived.state,
          quietMs,
          {
            subtreeIdle: () => isClaudeSubtreeIdle(session.pid),
            promptOrphaned: isTrailingPromptOrphaned(
              derived.timestampMs,
              session.startedAt,
            ),
          },
          undefined,
          now,
        );
        publishedState = decayed.state;
        staleDeadline = decayed.recheckAt;
      }
    }
    scheduleStaleRecheck(staleDeadline);

    scanTasksIncremental(transcriptWatching.path);

    // Only read journals when the agent is actually busy-waiting on a
    // background task — keeps the common path off the (potentially large)
    // journal files. Recomputed here (not change-gated) so a climbing
    // fan-out count refreshes via the workflows-dir watcher below.
    const workflow =
      publishedState === "running_background"
        ? deriveWorkflowProgress(session, outstanding, observe)
        : null;

    const info: ClaudeCodeInfo = {
      kind: "claude-code",
      state: publishedState,
      sessionId: session.sessionId,
      model: derived.model,
      summary: lastSummary,
      taskProgress: deriveTaskProgress(taskMap),
      contextTokens: derived.contextTokens,
      workflow,
    };

    if (!claudeInfoEqual(info, lastInfo)) {
      plog.debug(
        { state: info.state, model: info.model, session: info.sessionId },
        "claude code state updated",
      );
      lastInfo = info;
      onUpdate(info);
    }

    // Fire-and-forget: refreshSummary owns its try/catch/finally and
    // the pendingSummaryFetches counter. Not awaited so the caller
    // (transcript-change handler) doesn't block on the network fetch.
    void refreshSummary();
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

  /** Watch the per-session `workflows/` snapshot dir so a workflow's completion
   *  snapshot (`<runId>.json`) re-derives progress even when the transcript is
   *  quiet. Live progress under `subagents/workflows/<runId>/` is NOT watched
   *  (a recursive watch there proved unreliable on macOS, #1123); the reused
   *  stale-recheck timer (`nextWorkflowStaleDeadline`, anchored on the live run
   *  dir's newest file) drives live re-derivation instead, so the fan-out count
   *  refreshes each window rather than on every append. */
  function setupWorkflowsWatching() {
    workflowsDirWatcher = watchOrWaitForDir(
      workflowsDirFor(session),
      () => scheduleTranscriptCheck(),
      plog,
    );
  }

  // --- Start watching ---
  setupTranscriptWatching();
  setupWorkflowsWatching();

  return {
    session,

    destroy() {
      destroyed = true;
      if (transcriptDebounceTimer) {
        clearTimeout(transcriptDebounceTimer);
        transcriptDebounceTimer = null;
      }
      if (staleDeadlineTimer) {
        clearTimeout(staleDeadlineTimer);
        staleDeadlineTimer = null;
      }
      teardownTranscriptWatching();
      workflowsDirWatcher?.();
      workflowsDirWatcher = null;
    },
  };
}
