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
  decayTrailingTransient,
  deriveState,
  deriveTaskProgress,
  extractTasks,
  fetchSessionSummary,
  firstTranscriptTimestampMs,
  nextStaleDeadline,
  outstandingBackgroundTasks,
  outstandingForkRuns,
  type SessionFile,
  subagentsDirFor,
  TAIL_BYTES,
  tailJsonlLines,
  trailingTransient,
  transcriptPathFor,
  watchOrWaitForDir,
  workflowsDirFor,
  workflowView,
} from "./core.ts";
import type { ClaudeCodeInfo, ClaudeWorkflow } from "./schemas.ts";

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

const TRANSCRIPT_DEBOUNCE_MS = COALESCE_DEBOUNCE_MS;

const TASK_SCAN_CHUNK_BYTES = 1024 * 1024;

import type { Logger } from "kolu-shared";

export type { Logger as WatcherLog } from "kolu-shared";

let pendingSummaryFetches = 0;
export const getPendingSummaryFetches = (): number => pendingSummaryFetches;

interface SummaryFetcher {
  readonly refresh: () => Promise<void>;
  readonly destroy: () => void;
}

function createSummaryFetcher(
  session: SessionFile,
  onSummary: (summary: string | null) => void,
  plog: Logger,
): SummaryFetcher {
  let dispatched = 0;
  let applied = 0;
  let destroyed = false;

  return {
    async refresh() {
      if (destroyed) return;
      const seq = ++dispatched;
      pendingSummaryFetches++;
      try {
        const summary = await fetchSessionSummary(
          session.sessionId,
          session.cwd,
        );
        if (destroyed || seq <= applied) return;
        applied = seq;
        onSummary(summary);
      } catch (err) {
        plog.debug(
          { err, session: session.sessionId },
          "getSessionInfo failed",
        );
      } finally {
        pendingSummaryFetches--;
      }
    },

    destroy() {
      destroyed = true;
    },
  };
}

interface TaskScanner {
  readonly scan: (filePath: string) => void;
  readonly progress: () => ClaudeCodeInfo["taskProgress"];
}

function createTaskScanner(plog: Logger): TaskScanner {
  const tasks = new Map<string, "pending" | "in_progress" | "completed">();
  let scanOffset = 0;
  let remainder = "";

  return {
    scan(filePath) {
      try {
        const fd = fs.openSync(filePath, "r");
        try {
          const size = fs.fstatSync(fd).size;
          if (scanOffset >= size) return;
          const prevOffset = scanOffset;
          let carried = remainder;
          let changed = false;
          let offset = scanOffset;
          while (offset < size) {
            const toRead = Math.min(TASK_SCAN_CHUNK_BYTES, size - offset);
            const buf = Buffer.alloc(toRead);
            fs.readSync(fd, buf, 0, toRead, offset);
            const text = carried + buf.toString("utf8");
            const lines = text.split("\n");

            carried = lines.pop() ?? "";
            const complete = lines.filter((l) => l.length > 0);
            if (complete.length > 0) {
              if (extractTasks(complete, tasks, plog)) changed = true;
            }
            offset += toRead;
          }
          remainder = carried;
          scanOffset = size;
          if (changed) {
            plog.debug(
              {
                tasks: tasks.size,
                progress: deriveTaskProgress(tasks),
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
        plog.error({ err, filePath, scanOffset }, "task scan failed");
      }
    },

    progress: () => deriveTaskProgress(tasks),
  };
}

export interface SessionWatcher {
  readonly session: SessionFile;
  readonly destroy: () => void;
}

export function createSessionWatcher(
  session: SessionFile,
  onUpdate: (info: ClaudeCodeInfo) => void,
  plog: Logger,
): SessionWatcher {
  const transcriptPath = transcriptPathFor(session);

  let transcriptUnsub: (() => void) | null = null;
  let lastInfo: ClaudeCodeInfo | null = null;
  let lastSummary: string | null = null;

  let startedAt: number | null = null;
  const tasks = createTaskScanner(plog);

  const summaries = createSummaryFetcher(
    session,
    (summary) => {
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
    },
    plog,
  );

  const transcriptCoalesce = createCoalesceSchedule({
    debounceMs: TRANSCRIPT_DEBOUNCE_MS,
    maxWaitMs: COALESCE_MAX_WAIT_MS,
    onFire: () => onTranscriptMaybeChanged(),
  });

  let staleDeadlineTimer: NodeJS.Timeout | null = null;

  let workflowsDirWatcher: (() => void) | null = null;

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

  function scheduleTranscriptCheck() {
    if (destroyed) return;
    transcriptCoalesce.schedule();
  }

  function scheduleStaleRecheck(deadline: number | null) {
    if (staleDeadlineTimer) {
      clearTimeout(staleDeadlineTimer);
      staleDeadlineTimer = null;
    }
    if (destroyed || deadline === null) return;

    const delay = Math.max(0, deadline - Date.now()) + 1;
    staleDeadlineTimer = setTimeout(() => {
      staleDeadlineTimer = null;
      onTranscriptMaybeChanged();
    }, delay);
  }

  function setupTranscriptWatching() {
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

    onTranscriptMaybeChanged();
  }

  function transcriptQuietMs(filePath: string, now: number): number | null {
    try {
      return now - fs.statSync(filePath).mtimeMs;
    } catch {
      return null;
    }
  }

  function onTranscriptMaybeChanged() {
    if (destroyed) return;
    const lines = tailJsonlLines(transcriptPath, TAIL_BYTES);

    const now = Date.now();
    const workflows = workflowView(session, now);

    const completed = completedBackgroundTaskIds(lines);

    const outstanding = workflows.liveTasks(
      outstandingBackgroundTasks(lines, completed),
    );
    const derived = deriveState(lines, outstanding);
    if (!derived) {
      plog.debug(
        { path: transcriptPath },
        "no user/assistant message in transcript tail",
      );
      return;
    }

    const forks =
      derived.state === "waiting"
        ? outstandingForkRuns(session, completed, now)
        : [];

    let publishedState = derived.state;
    let staleDeadline: number | null = null;

    const live = [...workflows.runs(outstanding), ...forks];
    if (live.length > 0) {
      publishedState = "running_background";

      staleDeadline = nextStaleDeadline(live, now);
    } else {
      const quietMs = transcriptQuietMs(transcriptPath, now);
      if (quietMs !== null) {
        const decayed = decayTrailingTransient(
          trailingTransient(derived.state, derived.timestampMs, session),
          quietMs,
          undefined,
          now,
        );
        publishedState = decayed.state;
        staleDeadline = decayed.recheckAt;
      }
    }
    scheduleStaleRecheck(staleDeadline);

    tasks.scan(transcriptPath);

    const workflow =
      publishedState === "running_background"
        ? workflows.progress(outstanding)
        : null;

    startedAt ??= firstTranscriptTimestampMs(transcriptPath);

    const info: ClaudeCodeInfo = {
      kind: "claude-code",
      state: publishedState,
      sessionId: session.sessionId,
      model: derived.model,
      summary: lastSummary,
      taskProgress: tasks.progress(),
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

    void summaries.refresh();
  }

  function setupWorkflowsWatching() {
    workflowsDirWatcher = watchOrWaitForDir(
      workflowsDirFor(session),
      () => scheduleTranscriptCheck(),
      plog,
    );
  }

  function setupSubagentsWatching() {
    subagentsDirWatcher = watchOrWaitForDir(
      subagentsDirFor(session),
      () => scheduleTranscriptCheck(),
      plog,
    );
  }

  setupTranscriptWatching();
  setupWorkflowsWatching();
  setupSubagentsWatching();

  return {
    session,

    destroy() {
      destroyed = true;
      summaries.destroy();
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
