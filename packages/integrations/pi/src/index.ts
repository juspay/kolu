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
  parseSessionDirFlag,
  resolveSessionDir,
  type SessionDirResolution,
} from "./session-root.ts";
export { createPiWatcher, type PiWatcher } from "./session-watcher.ts";
export {
  loadPiTranscript,
  normalizePiToolInput,
  parsePiTranscript,
} from "./transcript.ts";

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
