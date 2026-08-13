/**
 * Grok Build CLI integration — public barrel.
 *
 * Module layout:
 *   - `core.ts`                    — leaf helpers (resolve, fold state)
 *   - `active-sessions-watcher.ts` — process-wide active_sessions fan-out
 *   - `session-watcher.ts`         — per-session events/summary watch
 *   - `agent-adapter.ts`           — `AgentAdapter` the sensors consume
 *   - `schemas.ts`                 — Effect schemas + types (browser-safe)
 *   - `config.ts`                  — env-resolved home paths
 */

export type { Logger } from "kolu-shared";
export { grokAdapter } from "./agent-adapter.ts";
export {
  ACTIVE_SESSIONS_PATH,
  GROK_DIR,
  SESSIONS_DIR,
} from "./config.ts";
export {
  type ActiveSessionEntry,
  chatHistoryPathFor,
  deriveGrokInfo,
  deriveStateFromEvents,
  encodeCwd,
  findLatestSessionByCwd,
  foldEventsState,
  type GrokFoldEvent,
  type GrokSession,
  type GrokSummary,
  grokHomePresent,
  hasOpenUserBlockingTool,
  KNOWN_PHASES,
  PHASE_TO_STATE,
  USER_BLOCKING_TOOLS,
  readActiveSessions,
  readContextTokens,
  readSummary,
  resolveGrokSession,
  resolveGrokSessions,
  signalsPathFor,
} from "./core.ts";
export {
  type GrokInfo,
  GrokInfoSchema,
  type TaskProgress,
  TaskProgressSchema,
} from "./schemas.ts";
export { type GrokWatcher, createGrokWatcher } from "./session-watcher.ts";
export {
  contentToText,
  eventsFromGrokLine,
  loadGrokTranscript,
  normalizeGrokToolInput,
  parseGrokChatHistory,
  unwrapGrokUserText,
} from "./transcript.ts";
