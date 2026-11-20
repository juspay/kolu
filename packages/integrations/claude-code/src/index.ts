export { claudeCodeAdapter } from "./agent-adapter.ts";

export {
  type BackgroundTask,
  completedBackgroundTaskIds,
  deriveState,
  deriveTaskProgress,
  encodeProjectPath,
  extractTasks,
  FORK_TRANSCRIPT_STALE_MS,
  fetchSessionSummary,
  isWorkflowTask,
  type LiveRun,
  nextStaleDeadline,
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
  WORKFLOW_JOURNAL_STALE_MS,
  type WorkflowTask,
  type WorkflowView,
  watchOrWaitForDir,
  workflowsDirFor,
  workflowView,
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
