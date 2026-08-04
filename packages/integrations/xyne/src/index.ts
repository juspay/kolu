/**
 * Xyne CLI integration — public barrel.
 *
 * Module layout:
 *   - `core.ts`                — leaf helpers (resolve, derive)
 *   - `sessions-dir-watcher.ts` — process-wide sessions-tree fan-out
 *   - `session-watcher.ts`     — per-session transcript/summary watch
 *   - `agent-adapter.ts`       — `AgentAdapter` the sensors consume
 *   - `schemas.ts`             — zod schemas + types (browser-safe)
 *   - `config.ts`              — env-resolved home paths
 */

export type { Logger } from "kolu-shared";
export { xyneAdapter } from "./agent-adapter.ts";
export { SESSIONS_DIR, XYNE_DIR } from "./config.ts";
export {
  deriveXyneInfo,
  encodeCwd,
  readLatestModel,
  readSummary,
  readTranscriptHeader,
  resolveXyneSession,
  type XyneSession,
  type XyneTranscriptHeader,
  xyneSessionsPresent,
} from "./core.ts";
export {
  type TaskProgress,
  TaskProgressSchema,
  type XyneInfo,
  XyneInfoSchema,
} from "./schemas.ts";
export {
  type XyneWatcher,
  createXyneWatcher,
  DEBOUNCE_MS as XYNE_DEBOUNCE_MS,
  DEBOUNCE_MAX_MS as XYNE_DEBOUNCE_MAX_MS,
} from "./session-watcher.ts";
