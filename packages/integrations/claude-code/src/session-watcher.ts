/**
 * SessionWatcher — encapsulates all per-session lifecycle state.
 *
 * Creating a SessionWatcher starts transcript watching, task scanning,
 * and summary fetching. Destroying it tears everything down. No "remember
 * to reset N variables" invariant — the lifetime IS the object.
 *
 * The server's claude adapter creates one of these per matched session
 * and replaces it on session change.
 */

import fs from "node:fs";
import { agentInfoEqual } from "anyagent";
import {
  COALESCE_DEBOUNCE_MS,
  COALESCE_MAX_WAIT_MS,
  createCoalesceSchedule,
  DEFAULT_APPEND_POLL_MS,
  subscribeFileAppends,
} from "kolu-io";
import {
  completedBackgroundTaskIds,
  decayTransientState,
  deriveState,
  deriveTaskProgress,
  deriveWorkflowProgress,
  extractTasks,
  fetchSessionSummary,
  firstTranscriptTimestampMs,
  isClaudeSubtreeIdle,
  liveOutstandingTasks,
  liveWorkflowRuns,
  nextStaleDeadline,
  observeWorkflowRun,
  outstandingBackgroundTasks,
  outstandingSubagentRuns,
  type SessionFile,
  type WorkflowObservation,
  subagentsDirFor,
  TAIL_BYTES,
  tailJsonlLines,
  transcriptPathFor,
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

/** Quiet-window for the transcript coalesce schedule. Claude streams
 *  tokens, and Linux fs.watch fires multiple events per write — without
 *  coalescing, `onTranscriptMaybeChanged` runs dozens to hundreds of
 *  times per second. Shared `COALESCE_DEBOUNCE_MS` + maxWait (#1952). */
const TRANSCRIPT_DEBOUNCE_MS = COALESCE_DEBOUNCE_MS;

/** Chunk size for `scanTasksIncremental`. The previous one-shot
 *  `Buffer.alloc(size - offset)` could allocate hundreds of MB transiently
 *  on first attach to a pre-existing transcript, pushing a climbing heap
 *  over V8's 4 GB ceiling. 1 MB bounds peak transient memory regardless
 *  of file size. */
const TASK_SCAN_CHUNK_BYTES = 1024 * 1024;

// --- Transcript watching lifecycle ---

// The transcript is watched by `subscribeFileAppends` (kolu-io): an `fs.watch`
// fast path plus a `statSync` poll floor that survives a dropped/coalesced
// terminal-append edge (juspay/kolu#1754). It subscribes on the DETERMINISTIC
// transcript path unconditionally — the file need not exist yet — so the old
// none/waiting/watching state machine and its dir-watch appearance bootstrap
// (which a dropped projectDir edge could strand) are gone; the floor tolerates
// absence and fires on appearance.

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
  // The deterministic transcript path, watched unconditionally (see below).
  const transcriptPath = transcriptPathFor(session);
  // Unsubscribe for the append-robust transcript watch; null until set up.
  let transcriptUnsub: (() => void) | null = null;
  let lastInfo: ClaudeCodeInfo | null = null;
  let lastSummary: string | null = null;
  // Ordering fence for the async summary fetch. Each `refreshSummary` dispatch
  // takes the next `summaryFetchSeq`; a resolved fetch applies only if its seq
  // is still the newest applied. `getSessionInfo` has no ordering guarantee, so
  // two in-flight fetches can resolve out of order — without this fence an OLDER
  // fetch could resolve last and publish a STALE summary over a newer one. The
  // fence keeps `lastSummary` monotonic in dispatch order, and so also drops the
  // spurious emit a stale late completion would otherwise fire. (Recency itself is
  // guarded deeper: the fold stamps with kolu's OWN intake clock, throttled — it
  // never imports a fetch's completion time — so this fence is about summary
  // CONTENT, not the recency clock.)
  let summaryFetchSeq = 0;
  let lastAppliedSummarySeq = 0;
  // Conversation start = the transcript's first `timestamp`, immutable once the
  // first message exists. Resolved lazily off the transcript head and cached:
  // null until the first message lands, then the head read never runs again. NB
  // this is NOT `session.startedAt` (process start, reset on `claude -c` resume,
  // used for orphan detection) — the inspector wants the conversation's age,
  // which survives resume, matching codex/opencode's "Running for" semantics.
  let startedAt: number | null = null;
  const taskMap = new Map<string, "pending" | "in_progress" | "completed">();
  let taskScanOffset = 0;
  // Partial final line from the previous chunked scan. Carried across
  // calls so a line straddling a chunk or EOF boundary resolves to a
  // single complete line once the newline arrives. Without this, the
  // tail of one call would be split-processed at the head of the next
  // call as if it were already a complete line — silent task corruption.
  let taskScanRemainder = "";
  // Quiet + maxWait coalesce for transcript edges (#1952 shared primitive).
  // Destroyed in `destroy()` so late fires can't run after teardown.
  const transcriptCoalesce = createCoalesceSchedule({
    debounceMs: TRANSCRIPT_DEBOUNCE_MS,
    maxWaitMs: COALESCE_MAX_WAIT_MS,
    onFire: () => onTranscriptMaybeChanged(),
  });
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
  // Watcher over the per-session `subagents/` dir, where an async sub-agent
  // (a `/fork`, an `Agent`, or a `Task` run) lands its `agent-<id>.meta.json` +
  // streaming `agent-<id>.jsonl`. Its launch never lands as a runId-bearing
  // `tool_result` in the MAIN transcript, and its artifacts may appear AFTER the
  // transcript event that idled the main has already been processed — at which
  // point nothing else would re-trigger the sub-agent scan. This watcher closes
  // that race: the moment the sub-agent's files land (create or append), it
  // reschedules the check so the now-`waiting` main promotes to
  // `running_background`. Null until set up.
  let subagentsDirWatcher: (() => void) | null = null;

  let destroyed = false;

  function teardownTranscriptWatching() {
    if (transcriptUnsub) {
      transcriptUnsub();
      transcriptUnsub = null;
      plog.info(
        { path: transcriptPath, session: session.sessionId },
        "claude-code: transcript watcher retired",
      );
    }
  }

  /** Coalesced transcript re-derive: quiet window `TRANSCRIPT_DEBOUNCE_MS`,
   *  hard maxWait `COALESCE_MAX_WAIT_MS` so a continuous token-stream burst
   *  cannot starve the handler (juspay/kolu#1952). */
  function scheduleTranscriptCheck() {
    if (destroyed) return;
    transcriptCoalesce.schedule();
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

  function setupTranscriptWatching() {
    // Subscribe UNCONDITIONALLY on the deterministic transcript path
    // (juspay/kolu#1754, Q7). Claude writes the JSONL lazily after the first
    // message, so it may not exist yet — the append-robust floor tolerates
    // absence and fires on appearance, so no separate dir-watch bootstrap is
    // needed. The floor also means a dropped fs.watch edge (a fast turn's
    // completion append) can no longer strand the live-state: it self-heals on
    // the next poll. `scheduleTranscriptCheck` is the existing 150 ms-debounced,
    // change-gated handler both the edge and the floor feed.
    transcriptUnsub = subscribeFileAppends(
      transcriptPath,
      () => scheduleTranscriptCheck(),
      {
        intervalMs: DEFAULT_APPEND_POLL_MS,
        log: plog,
        label: "claude-code: transcript",
      },
    );
    plog.info(
      { path: transcriptPath, session: session.sessionId },
      "claude-code: transcript watcher installed",
    );
    // Initial read covers the file-already-present-at-attach window (B4); an
    // absent file reads as [] and derives nothing, harmlessly.
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
    const lines = tailJsonlLines(transcriptPath, TAIL_BYTES);
    // One clock read for the whole pass: the workflow-staleness filter
    // (`liveOutstandingTasks`), the sub-agent scan, both stale deadlines, and the
    // transient-decay quiet window all compare against this single `now`, so no
    // two staleness checks in one pass can disagree about the current time.
    const now = Date.now();
    // observeWorkflowRun is the single source of truth; the three projections
    // below (liveOutstandingTasks / liveWorkflowRuns /
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
    // The shared "which runs finished" projection (core.ts:545), scanned over
    // the tail ONCE per pass and threaded into both consumers below —
    // `outstandingBackgroundTasks` (launched − completed) and
    // `outstandingSubagentRuns` (fast positive-finish signal). Mirrors the `obs`
    // memoization above: read the projection once, hand it to every reader.
    const completed = completedBackgroundTaskIds(lines);
    // Drop tasks that can't keep the session "working": a `Workflow` whose
    // journal has gone terminal/stale (orphaned by a restart). `deriveState`
    // further narrows to runId-bearing `Workflow` runs, so a bare backgrounded
    // Bash/Agent never promotes. Together: only a live, observable workflow
    // keeps `running_background`.
    const outstanding = liveOutstandingTasks(
      session,
      outstandingBackgroundTasks(lines, completed),
      now,
      observe,
    );
    const derived = deriveState(lines, outstanding);
    if (!derived) {
      plog.debug(
        { path: transcriptPath },
        "no user/assistant message in transcript tail",
      );
      return;
    }

    // Background sub-agent promotion: a sub-agent (a `/fork` or an async
    // `Agent`/`Task` run) is a background sub-agent the main session launched,
    // but its launch never reaches `deriveState`'s promotion path — a `/fork`
    // echoes only a local-command line, and an async `Agent`/`Task`
    // confirmation enters the launched set with `runId` null, which the
    // runId-narrowing skips. Detect it from its on-disk subagent transcript —
    // but only for an otherwise-idle (`waiting`) main, where a live
    // sub-agent means it's busy-waiting on the run, not awaiting the human,
    // and only for a sub-agent POSITIVELY classified as background (meta
    // `agentType:"fork"` or an async-launch confirmation on this transcript —
    // `outstandingSubagentRuns`'s discriminator) so a finished synchronous
    // sub-agent's still-fresh artifacts can't publish a phantom. When a live
    // `Workflow` already promoted to `running_background`, the row is busy
    // regardless, so the sub-agent scan (a `subagents/` readdir) is skipped.
    const subagents =
      derived.state === "waiting"
        ? outstandingSubagentRuns(session, lines, completed, now)
        : [];

    // Resolve the state to publish and when (if ever) to re-probe. One
    // escalation and two staleness-driven de-escalations live here, on disjoint
    // states — a quiet transcript / journal fires no fs event, so each arms the
    // reused one-shot recheck timer that re-derives without an external trigger:
    //   - running_background: a busy-wait on an observable background run — a
    //     `Workflow` (journal, #1109) or a live async sub-agent (streaming
    //     subagent transcript). Promoted from `waiting` for a sub-agent; demoted
    //     once every run's anchor goes stale, the deadline tracking the soonest
    //     across both.
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
    // The live background runs keeping this main busy-waiting, both kinds folded
    // to one `LiveRun` set: workflows (journal-anchored) and async sub-agents
    // (transcript-anchored). Each producer keeps its own anchor-reading IO
    // private; the watcher just plugs into the single set and its one deadline
    // fold.
    const live = [
      ...liveWorkflowRuns(session, outstanding, observe),
      ...subagents,
    ];
    if (live.length > 0) {
      publishedState = "running_background";
      // Soonest stale deadline across every live run, on each run's own window —
      // so a sub-agent-only or workflow-only promotion still arms a recheck, and
      // a mixed set fires on whichever ages out first.
      staleDeadline = nextStaleDeadline(live, now);
    } else {
      const quietMs = transcriptQuietMs(transcriptPath, now);
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

    scanTasksIncremental(transcriptPath);

    // Only read journals when the agent is actually busy-waiting on a
    // background task — keeps the common path off the (potentially large)
    // journal files. Recomputed here (not change-gated) so a climbing
    // fan-out count refreshes via the workflows-dir watcher below.
    const workflow =
      publishedState === "running_background"
        ? deriveWorkflowProgress(session, outstanding, observe)
        : null;

    // Conversation age (survives `claude -c` resume), resolved once off the
    // transcript head and cached — see the `startedAt` declaration.
    startedAt ??= firstTranscriptTimestampMs(transcriptPath);

    const info: ClaudeCodeInfo = {
      kind: "claude-code",
      state: publishedState,
      sessionId: session.sessionId,
      model: derived.model,
      summary: lastSummary,
      taskProgress: deriveTaskProgress(taskMap),
      contextTokens: derived.contextTokens,
      workflow,
      startedAt,
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
      const fd = fs.openSync(filePath, "r");
      try {
        const size = fs.fstatSync(fd).size;
        if (taskScanOffset >= size) return;
        const prevOffset = taskScanOffset;
        let carried = taskScanRemainder;
        let changed = false;
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
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      plog.error({ err, filePath, taskScanOffset }, "task scan failed");
    }
  }

  async function refreshSummary() {
    if (destroyed) return;
    const seq = ++summaryFetchSeq;
    pendingSummaryFetches++;
    try {
      const summary = await fetchSessionSummary(session.sessionId, session.cwd);
      if (destroyed) return;
      // Out-of-order drop: a fetch dispatched before one already applied
      // resolved late — its result (and its completion timestamp) is stale.
      // Advance the fence for ANY newest-so-far completion, including a
      // no-change one: otherwise a newer no-op resolution would leave the fence
      // un-advanced and let an OLDER in-flight fetch resolve later, pass the
      // `seq <=` gate, and apply a stale summary + late recency stamp.
      if (seq <= lastAppliedSummarySeq) return;
      lastAppliedSummarySeq = seq;
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
   *  stale-recheck timer (`nextStaleDeadline` over the live workflow runs,
   *  anchored on the live run dir's newest file) drives live re-derivation
   *  instead, so the fan-out count refreshes each window rather than on every
   *  append. */
  function setupWorkflowsWatching() {
    workflowsDirWatcher = watchOrWaitForDir(
      workflowsDirFor(session),
      () => scheduleTranscriptCheck(),
      plog,
    );
  }

  /** Watch the per-session `subagents/` dir so an async sub-agent's artifacts
   *  (`agent-<id>.meta.json` + streaming `agent-<id>.jsonl`) re-run the sub-agent
   *  scan the moment they land — even when the main transcript has already gone
   *  quiet. A sub-agent's launch never lands as a runId-bearing `tool_result` in
   *  the MAIN transcript, but the scan it triggers can run BEFORE the sub-agent's
   *  files exist; without this watch nothing would re-trigger and the now-idle
   *  main would stay `waiting` for the full stale window. A non-recursive watch
   *  suffices: the sub-agent's files land directly in `subagents/` (the
   *  `subagents/workflows/` live tree is a direct child dir, separately handled).
   *  `watchOrWaitForDir` tolerates the dir not existing yet — `subagents/` AND
   *  its `<session>/` parent are both created lazily on the first sub-agent, and
   *  the helper walks up to the nearest existing ancestor, re-attaching down the
   *  chain as each level appears. */
  function setupSubagentsWatching() {
    subagentsDirWatcher = watchOrWaitForDir(
      subagentsDirFor(session),
      () => scheduleTranscriptCheck(),
      plog,
    );
  }

  // --- Start watching ---
  setupTranscriptWatching();
  setupWorkflowsWatching();
  setupSubagentsWatching();

  return {
    session,

    destroy() {
      destroyed = true;
      transcriptCoalesce.destroy();
      if (staleDeadlineTimer) {
        clearTimeout(staleDeadlineTimer);
        staleDeadlineTimer = null;
      }
      teardownTranscriptWatching();
      workflowsDirWatcher?.();
      workflowsDirWatcher = null;
      subagentsDirWatcher?.();
      subagentsDirWatcher = null;
    },
  };
}
