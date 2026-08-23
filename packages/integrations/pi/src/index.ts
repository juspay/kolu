/**
 * Pi integration — public barrel.
 *
 * Module layout:
 *   - `core.ts`            — leaf helpers (session discovery, state fold,
 *                            sessions-tree watcher)
 *   - `session-watcher.ts` — per-session transcript watch → PiInfo stream
 *   - `agent-adapter.ts`   — `AgentAdapter` the sensors consume
 *   - `schemas.ts`         — Effect schemas + types (browser-safe)
 *   - `config.ts`          — env-resolved home paths
 *
 * Peers import from their leaves; `index.ts` is a pure barrel so nothing has
 * to reach back through it (the codex/grok cycle precedent, #710).
 */

export type { Logger } from "kolu-shared";
export { piAdapter } from "./agent-adapter.ts";
export { SESSIONS_DIR } from "./config.ts";
export {
  derivePiInfo,
  derivePiState,
  findSessionsByDirectory,
  type PiSession,
  piHomePresent,
  parseSessionFileName,
  sessionDirFor,
  sessionDirNameFor,
  subscribeSessionsTree,
} from "./core.ts";
export {
  type PiInfo,
  PiInfoSchema,
  type TaskProgress,
  TaskProgressSchema,
} from "./schemas.ts";
export { createPiWatcher, type PiWatcher } from "./session-watcher.ts";
export {
  loadPiTranscript,
  normalizePiToolInput,
  parsePiTranscript,
} from "./transcript.ts";
