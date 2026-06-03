/**
 * Claude Code integration — public barrel.
 *
 * Module layout:
 *   - `core.ts`            — leaf helpers (session-file reading, transcript
 *                            tail, state derivation, fs.watch helpers, shared
 *                            SESSIONS_DIR watcher, SDK summary fetch)
 *   - `session-watcher.ts` — per-session lifecycle object built on `core`
 *   - `agent-provider.ts`  — `AgentProvider` instance the server consumes
 *   - `schemas.ts`         — zod schemas + types (browser-safe)
 *
 * `core` is the only thing `session-watcher` and `agent-provider` import
 * from this package. `index.ts` is a pure barrel — anything imported via
 * `kolu-claude-code` flows through here so the public surface stays in
 * one place, and `session-watcher` / `agent-provider` never have to reach
 * back through it (which was the #710 noImportCycles hit).
 */

export { claudeCodeProvider } from "./agent-provider.ts";

export {
  type BackgroundTask,
  completedBackgroundTaskIds,
  deriveState,
  deriveTaskProgress,
  deriveWorkflowProgress,
  encodeProjectPath,
  extractTasks,
  fetchSessionSummary,
  findTranscriptPath,
  FORK_TRANSCRIPT_STALE_MS,
  liveOutstandingTasks,
  liveWorkflowRuns,
  type LiveRun,
  nextStaleDeadline,
  type ObserveWorkflowRun,
  observeWorkflowRun,
  outstandingBackgroundTasks,
  outstandingForkRuns,
  PROJECTS_DIR,
  readSessionFile,
  SESSIONS_DIR,
  type SessionFile,
  SUMMARY_FETCH_ENABLED,
  subagentsDirFor,
  subscribeSessionsDir,
  TAIL_BYTES,
  tailJsonlLines,
  tryWatchDir,
  watchOrWaitForDir,
  type WorkflowObservation,
  WORKFLOW_JOURNAL_STALE_MS,
  workflowsDirFor,
} from "./core.ts";
export {
  type ClaudeCodeInfo,
  ClaudeCodeInfoSchema,
  type ClaudeWorkflow,
  ClaudeWorkflowSchema,
  type TaskProgress,
  TaskProgressSchema,
} from "./schemas.ts";
export {
  createSessionWatcher,
  getPendingSummaryFetches,
  type SessionWatcher,
  type WatcherLog,
} from "./session-watcher.ts";

export {
  loadClaudeCodeTranscript,
  parseClaudeCodeJsonl,
} from "./transcript.ts";
