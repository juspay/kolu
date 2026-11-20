export type { Logger } from "kolu-shared";
export { codexAdapter } from "./agent-adapter.ts";
export { CODEX_DB_PATH, CODEX_DB_WAL_PATH, CODEX_DIR } from "./config.ts";

export {
  type CodexSession,
  findSessionsByDirectory,
  getThreadMetadata,
  missingThreadColumns,
  openDb,
  parseRolloutContextTokens,
  parseRolloutState,
  REQUIRED_THREAD_COLUMNS,
  type ThreadMetadata,
} from "./core.ts";
export {
  type CodexInfo,
  CodexInfoSchema,
  type TaskProgress,
  TaskProgressSchema,
} from "./schemas.ts";
export { type CodexWatcher, createCodexWatcher } from "./session-watcher.ts";
export { loadCodexTranscript, parseCodexRollout } from "./transcript.ts";
export { subscribeCodexDb } from "./wal-watcher.ts";

import type { AgentPlugin } from "anyagent";
import type { Fetcher } from "kolu-transcript-core";
import { codexAdapter } from "./agent-adapter.ts";
import { CODEX_ENV_KEYS } from "./config.ts";
import type { CodexSession } from "./core.ts";
import { type CodexInfo, codexVocab } from "./schemas.ts";
import { loadCodexTranscript } from "./transcript.ts";

export const codexPlugin: AgentPlugin<CodexSession, CodexInfo, Fetcher> = {
  vocab: codexVocab,
  adapter: codexAdapter,
  fetcher: loadCodexTranscript,
  envKeys: CODEX_ENV_KEYS,
};
