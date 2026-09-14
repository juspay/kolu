/**
 * Pi integration — public barrel.
 *
 * Module layout:
 *   - `core.ts`            — leaf helpers (session discovery, state fold,
 *                            sessions-tree watcher)
 *   - `session-root.ts`    — pi's session-store precedence chain + reading
 *                            the foreground pi process's argv/env
 *   - `session-watcher.ts` — per-session transcript watch → PiInfo stream
 *   - `agent-adapter.ts`   — `AgentAdapter` the sensors consume
 *   - `schemas.ts`         — Effect schemas + types (browser-safe)
 *   - `config.ts`          — env-resolved home paths
 *
 * Peers import from their leaves; `index.ts` is a pure barrel so nothing has
 * to reach back through it (the codex/grok cycle precedent, #710).
 */

export type { Logger } from "kolu-shared";
export { knownSessionStores, piAdapter } from "./agent-adapter.ts";
export { AGENT_DIR, SESSIONS_DIR } from "./config.ts";
export {
  defaultSessionStore,
  derivePiInfo,
  derivePiState,
  findSessionsByDirectory,
  type PiSession,
  parseSessionFileName,
  piHomePresent,
  type SessionStore,
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
export {
  type ProcessSnapshot,
  parseSessionDirFlag,
  readProcessSnapshot,
  resolveSessionDir,
  type SessionDirResolution,
} from "./session-root.ts";
export { createPiWatcher, type PiWatcher } from "./session-watcher.ts";
export {
  loadPiTranscript,
  normalizePiToolInput,
  parsePiTranscript,
} from "./transcript.ts";

// ── The plugin — the ONE contribution the registry (`kolu-agents`) folds. ──
import type { AgentPlugin } from "anyagent";
import type { Fetcher } from "kolu-transcript-core";
import { piAdapter } from "./agent-adapter.ts";
import { PI_ENV_KEYS } from "./config.ts";
import type { PiSession } from "./core.ts";
import { type PiInfo, piVocab } from "./schemas.ts";
import { loadPiTranscript } from "./transcript.ts";

export const piPlugin: AgentPlugin<PiSession, PiInfo, Fetcher> = {
  vocab: piVocab,
  adapter: piAdapter,
  fetcher: loadPiTranscript,
  envKeys: PI_ENV_KEYS,
};
