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
  type ReadOutcome,
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
  eventsFromGrokLine,
  loadGrokTranscript,
  normalizeGrokToolInput,
  parseGrokChatHistory,
  unwrapGrokUserText,
} from "./transcript.ts";

import type { AgentPlugin } from "anyagent";
import type { Fetcher } from "kolu-transcript-core";
import { grokAdapter } from "./agent-adapter.ts";
import { GROK_ENV_KEYS } from "./config.ts";
import type { GrokSession } from "./core.ts";
import { type GrokInfo, grokVocab } from "./schemas.ts";
import { loadGrokTranscript } from "./transcript.ts";

export const grokPlugin: AgentPlugin<GrokSession, GrokInfo, Fetcher> = {
  vocab: grokVocab,
  adapter: grokAdapter,
  fetcher: loadGrokTranscript,
  envKeys: GROK_ENV_KEYS,
};
