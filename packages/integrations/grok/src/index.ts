/**
 * Grok Build CLI integration — public barrel.
 *
 * Module layout:
 *   - `core.ts`                    — leaf helpers (resolve, fold state)
 *   - `active-sessions-watcher.ts` — process-wide active_sessions fan-out
 *   - `session-watcher.ts`         — per-session events/summary watch
 *   - `agent-adapter.ts`           — `AgentAdapter` the sensors consume
 *   - `schemas.ts`                 — zod schemas + types (browser-safe)
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
  deriveGrokInfo,
  deriveStateFromEvents,
  encodeCwd,
  findLatestSessionByCwd,
  foldEventsState,
  type GrokSession,
  type GrokSummary,
  grokHomePresent,
  KNOWN_PHASES,
  readActiveSessions,
  readSummary,
  resolveGrokSession,
} from "./core.ts";
export {
  type GrokInfo,
  GrokInfoSchema,
  type TaskProgress,
  TaskProgressSchema,
} from "./schemas.ts";
export { type GrokWatcher, createGrokWatcher } from "./session-watcher.ts";
