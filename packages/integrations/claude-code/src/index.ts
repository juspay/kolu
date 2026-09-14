/**
 * Claude Code integration — public barrel.
 *
 * Module layout:
 *   - `core.ts`            — leaf helpers (session-file reading, transcript
 *                            tail, state derivation, fs.watch helpers, shared
 *                            SESSIONS_DIR watcher, SDK summary fetch)
 *   - `session-watcher.ts` — per-session lifecycle object built on `core`
 *   - `agent-adapter.ts`  — `AgentAdapter` instance the server consumes
 *   - `schemas.ts`         — Effect schemas + types (browser-safe)
 *
 * `core` is the only thing `session-watcher` and `agent-adapter` import
 * from this package. `index.ts` is a pure barrel — anything imported via
 * `kolu-claude-code` flows through here so the public surface stays in
 * one place, and `session-watcher` / `agent-adapter` never have to reach
 * back through it (which was the #710 noImportCycles hit).
 */

export { claudeCodeAdapter } from "./agent-adapter.ts";

export {
  type BackgroundTask,
  completedBackgroundTaskIds,
  deriveState,
  deriveTaskProgress,
  deriveWorkflowProgress,
  encodeProjectPath,
  extractTasks,
  fetchSessionSummary,
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

// ── The plugin — the ONE contribution the registry (`kolu-agents`) folds. ──
import type { AgentPlugin } from "anyagent";
import type { Fetcher } from "kolu-transcript-core";
import { claudeCodeAdapter } from "./agent-adapter.ts";
import { CLAUDE_ENV_KEYS, type SessionFile } from "./core.ts";
import { type ClaudeCodeInfo, claudeCodeVocab } from "./schemas.ts";
import { getPendingSummaryFetches } from "./session-watcher.ts";
import { loadClaudeCodeTranscript } from "./transcript.ts";

export const claudeCodePlugin: AgentPlugin<
  SessionFile,
  ClaudeCodeInfo,
  Fetcher
> = {
  vocab: claudeCodeVocab,
  adapter: claudeCodeAdapter,
  fetcher: loadClaudeCodeTranscript,
  envKeys: CLAUDE_ENV_KEYS,
  diagnostics: () => ({ pendingSummaryFetches: getPendingSummaryFetches() }),
};
