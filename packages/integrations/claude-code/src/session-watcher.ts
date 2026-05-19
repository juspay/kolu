/**
 * SessionWatcher — per-session lifecycle, fully push-driven over the
 * executor. Same body for local and remote terminals.
 *
 * Lifecycle:
 *   1. Find the transcript JSONL path (`<projectsDir>/<encoded-cwd>/<id>.jsonl`).
 *      If it doesn't exist yet (Claude creates it on the first user↔assistant
 *      exchange), watch the project dir until it appears.
 *   2. Once attached, watch the transcript via `executor.watch`. Debounce
 *      the bursts (Claude streams tokens; the file fires many writes per
 *      turn).
 *   3. On each debounced tick: tail the JSONL via `executor.exec("tail", ...)`,
 *      derive state + accumulate TaskUpdates, emit `ClaudeCodeInfo` if it
 *      differs from the last.
 *
 * No polling. Task accumulation walks the tail each tick — TaskCreate is
 * always emitted right before its TaskUpdates, so accumulation stays
 * correct in the typical run.
 */

import { type AgentWatcher, agentInfoEqual, type Executor } from "anyagent";
import type { Logger } from "kolu-shared";
import {
  deriveState,
  deriveTaskProgress,
  encodeProjectPath,
  extractTasks,
  fetchSessionSummary,
  findTranscriptPath,
  type SessionFile,
  TAIL_BYTES,
  tailJsonlLines,
} from "./core.ts";
import type { ClaudeCodeInfo } from "./schemas.ts";

const TRANSCRIPT_DEBOUNCE_MS = 150;

let pendingSummaryFetches = 0;
export const getPendingSummaryFetches = (): number => pendingSummaryFetches;

export interface SessionWatcher extends AgentWatcher {
  readonly session: SessionFile;
}

export function createSessionWatcher(
  session: SessionFile,
  executor: Executor,
  onUpdate: (info: ClaudeCodeInfo) => void,
  plog: Logger,
): SessionWatcher {
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let transcriptHandle: { stop(): void } | null = null;
  let projectDirHandle: { stop(): void } | null = null;
  let transcriptPath: string | null = null;
  let lastInfo: ClaudeCodeInfo | null = null;
  let lastSummary: string | null = null;
  const taskMap = new Map<string, "pending" | "in_progress" | "completed">();
  let inFlight = false;
  let pending = false;

  function scheduleRefresh(): void {
    if (stopped) return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void refresh();
    }, TRANSCRIPT_DEBOUNCE_MS);
  }

  async function refresh(): Promise<void> {
    if (stopped || !transcriptPath) return;
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = true;
    try {
      const lines = await tailJsonlLines(
        transcriptPath,
        TAIL_BYTES,
        executor,
        plog,
      );
      if (stopped) return;
      const derived = deriveState(lines);
      if (!derived) {
        plog.debug(
          { path: transcriptPath },
          "no user/assistant message in transcript tail",
        );
        return;
      }
      extractTasks(lines, taskMap, plog);
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
      // Fire-and-forget summary refresh.
      void refreshSummary();
    } catch (err) {
      plog.debug({ err, session: session.sessionId }, "claude refresh failed");
    } finally {
      inFlight = false;
      if (pending && !stopped) {
        pending = false;
        setTimeout(() => void refresh(), 0);
      }
    }
  }

  async function refreshSummary(): Promise<void> {
    if (stopped) return;
    pendingSummaryFetches++;
    try {
      const summary = await fetchSessionSummary(session.sessionId, session.cwd);
      if (stopped) return;
      if (summary === lastSummary) return;
      lastSummary = summary;
      if (!lastInfo) return;
      const updated: ClaudeCodeInfo = { ...lastInfo, summary };
      lastInfo = updated;
      onUpdate(updated);
    } catch (err) {
      plog.debug({ err, session: session.sessionId }, "getSessionInfo failed");
    } finally {
      pendingSummaryFetches--;
    }
  }

  async function attachToTranscript(path: string): Promise<void> {
    try {
      transcriptHandle = await executor.watch(path, () => scheduleRefresh(), {
        recursive: false,
      });
      transcriptPath = path;
      plog.info(
        { path, session: session.sessionId },
        "claude-code: transcript watcher installed",
      );
      void refresh();
    } catch (err) {
      plog.error({ err, path }, "failed to watch transcript");
    }
  }

  async function tryFindAndAttach(): Promise<boolean> {
    const tp = await findTranscriptPath(session, executor);
    if (!tp || stopped) return false;
    plog.debug({ path: tp }, "transcript found");
    await attachToTranscript(tp);
    return true;
  }

  void (async () => {
    if (await tryFindAndAttach()) return;
    plog.debug(
      { session: session.sessionId, cwd: session.cwd },
      "transcript not found yet (JSONL created after first message); waiting on project dir",
    );
    const projectDir = `${session.projectsDir}/${encodeProjectPath(session.cwd)}`;
    try {
      projectDirHandle = await executor.watch(
        projectDir,
        () => {
          if (stopped || transcriptPath) return;
          void (async () => {
            const ok = await tryFindAndAttach();
            if (ok && projectDirHandle) {
              projectDirHandle.stop();
              projectDirHandle = null;
            }
          })();
        },
        { recursive: false },
      );
    } catch (err) {
      plog.debug({ err, projectDir }, "project dir watch failed");
    }
  })();

  return {
    session,
    destroy(): void {
      stopped = true;
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      transcriptHandle?.stop();
      projectDirHandle?.stop();
      transcriptHandle = null;
      projectDirHandle = null;
    },
  };
}
