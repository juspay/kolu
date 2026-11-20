export type { Logger } from "kolu-shared";
export { opencodeAdapter } from "./agent-adapter.ts";
export { OPENCODE_DB_PATH, OPENCODE_DB_WAL_PATH } from "./config.ts";

export {
  type AssistantFacts,
  type ContentPart,
  findSessionsByDirectory,
  getLatestAssistantFacts,
  getSessionTitle,
  type MessageState,
  type OpenCodeSession,
  openDb,
  parseMessageState,
  runningToolsBucket,
  stateFromLatestConversationalMessage,
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

import type { AgentPlugin } from "anyagent";
import type { Fetcher } from "kolu-transcript-core";
import { opencodeAdapter } from "./agent-adapter.ts";
import { OPENCODE_ENV_KEYS } from "./config.ts";
import type { OpenCodeSession } from "./core.ts";
import { type OpenCodeInfo, opencodeVocab } from "./schemas.ts";
import { loadOpenCodeTranscript } from "./transcript.ts";

export const opencodePlugin: AgentPlugin<
  OpenCodeSession,
  OpenCodeInfo,
  Fetcher
> = {
  vocab: opencodeVocab,
  adapter: opencodeAdapter,
  fetcher: loadOpenCodeTranscript,
  envKeys: OPENCODE_ENV_KEYS,
};
