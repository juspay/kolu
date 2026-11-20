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
