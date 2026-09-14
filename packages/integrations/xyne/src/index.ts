/**
 * Xyne CLI integration — public barrel.
 *
 * Module layout:
 *   - `core.ts`                — leaf helpers (resolve, derive)
 *   - `sessions-dir-watcher.ts` — process-wide sessions-tree fan-out
 *   - `session-watcher.ts`     — per-session transcript/summary watch
 *   - `agent-adapter.ts`       — `AgentAdapter` the sensors consume
 *   - `schemas.ts`             — Effect schemas + types (browser-safe)
 *   - `config.ts`              — env-resolved home paths
 */

export type { Logger } from "kolu-shared";
export { xyneAdapter } from "./agent-adapter.ts";
export { SESSIONS_DIR, XYNE_DIR, XYNE_ENV_KEYS } from "./config.ts";
export {
  deriveXyneInfo,
  encodeCwd,
  readLatestModel,
  readSummary,
  readTranscriptHeader,
  resolveXyneSession,
  resolveXyneSessions,
  type XyneSession,
  type XyneTranscriptHeader,
  xyneSessionStartedAt,
  xyneSessionsPresent,
} from "./core.ts";
export {
  type TaskProgress,
  TaskProgressSchema,
  type XyneInfo,
  XyneInfoSchema,
  xyneVocab,
} from "./schemas.ts";
export {
  contentToText,
  eventsFromXyneLine,
  loadXyneTranscript,
  normalizeXyneToolInput,
  parseXyneSessionJsonl,
} from "./transcript.ts";
// The per-session watcher stays module-internal — the adapter builds it
// inside `createWatcher`, and its debounce constants are kolu-io's shared
// COALESCE_* schedule, not xyne knobs. session-watcher.ts has no public
// callers yet; export it when one appears.

// ── The plugin — the ONE contribution the registry (`kolu-agents`) folds. ──
import type { AgentPlugin } from "anyagent";
import type { Fetcher } from "kolu-transcript-core";
import { xyneAdapter } from "./agent-adapter.ts";
import { XYNE_ENV_KEYS } from "./config.ts";
import type { XyneSession } from "./core.ts";
import { type XyneInfo, xyneVocab } from "./schemas.ts";
import { loadXyneTranscript } from "./transcript.ts";

export const xynePlugin: AgentPlugin<XyneSession, XyneInfo, Fetcher> = {
  vocab: xyneVocab,
  adapter: xyneAdapter,
  fetcher: loadXyneTranscript,
  envKeys: XYNE_ENV_KEYS,
};
