/**
 * OpenCode integration — public barrel.
 *
 * Module layout:
 *   - `core.ts`            — leaf helpers (SQLite lookup, state derivation,
 *                            running-tool detection, token lookup)
 *   - `wal-watcher.ts`     — refcounted shared WAL subscription
 *   - `session-watcher.ts` — per-session lifecycle object built on `core` + WAL
 *   - `agent-provider.ts`  — `AgentProvider` instance the server consumes
 *   - `schemas.ts`         — zod schemas + types (browser-safe)
 *   - `config.ts`          — env-resolved DB/WAL paths
 *
 * Peers import from their leaves; `index.ts` is a pure barrel so nothing
 * has to reach back through it. Breaks the index ↔ session-watcher ↔
 * agent-provider cycle (#710).
 */

export { OPENCODE_DB_PATH, OPENCODE_DB_WAL_PATH } from "./config.ts";

export type { Logger } from "anyagent";

export {
  type OpenCodeInfo,
  OpenCodeInfoSchema,
  type TaskProgress,
  TaskProgressSchema,
} from "./schemas.ts";

export {
  type DerivedState,
  deriveSessionState,
  findSessionByDirectory,
  getLatestAssistantContextTokens,
  getSessionTaskProgress,
  getSessionTitle,
  hasRunningTools,
  openDb,
  type OpenCodeSession,
  type ParsedMessageState,
  parseMessageState,
} from "./core.ts";

export {
  createOpenCodeWatcher,
  type OpenCodeWatcher,
} from "./session-watcher.ts";

export { subscribeOpenCodeDb } from "./wal-watcher.ts";

export { opencodeProvider } from "./agent-provider.ts";

export {
  eventsFromMessageParts,
  type LoadOpenCodeTranscriptInput,
  loadOpenCodeTranscript,
} from "./transcript.ts";
