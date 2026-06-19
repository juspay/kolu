/**
 * OpenCode integration — public barrel.
 *
 * Module layout:
 *   - `core.ts`            — leaf helpers (SQLite lookup, state derivation,
 *                            running-tool detection, token lookup)
 *   - `wal-watcher.ts`     — refcounted shared WAL subscription
 *   - `session-watcher.ts` — per-session lifecycle object built on `core` + WAL
 *   - `agent-adapter.ts`  — `AgentAdapter` instance the server consumes
 *   - `schemas.ts`         — zod schemas + types (browser-safe)
 *   - `config.ts`          — env-resolved DB/WAL paths
 *
 * Peers import from their leaves; `index.ts` is a pure barrel so nothing
 * has to reach back through it. Breaks the index ↔ session-watcher ↔
 * agent-adapter cycle (#710).
 */

export type { Logger } from "kolu-shared";
export { opencodeAdapter } from "./agent-adapter.ts";
export { OPENCODE_DB_PATH, OPENCODE_DB_WAL_PATH } from "./config.ts";

export {
  type DerivedState,
  deriveSessionState,
  findSessionByDirectory,
  getLatestAssistantContextTokens,
  getSessionTaskProgress,
  getSessionTitle,
  type OpenCodeSession,
  openDb,
  type ParsedMessageState,
  parseMessageState,
  runningToolsBucket,
} from "./core.ts";
export {
  type OpenCodeInfo,
  OpenCodeInfoSchema,
  type TaskProgress,
  TaskProgressSchema,
} from "./schemas.ts";
export {
  createOpenCodeWatcher,
  type OpenCodeWatcher,
} from "./session-watcher.ts";
export {
  eventsFromMessageParts,
  loadOpenCodeTranscript,
} from "./transcript.ts";
export { subscribeOpenCodeDb } from "./wal-watcher.ts";
