/**
 * Codex integration — public barrel.
 *
 * Module layout:
 *   - `core.ts`            — leaf helpers (SQLite lookup, JSONL state parse,
 *                            token count parse)
 *   - `wal-watcher.ts`     — refcounted shared WAL subscription
 *   - `session-watcher.ts` — per-session lifecycle object built on `core` + WAL
 *   - `agent-provider.ts`  — `AgentProvider` instance the server consumes
 *   - `schemas.ts`         — zod schemas + types (browser-safe)
 *   - `config.ts`          — env-resolved DB/WAL paths
 *
 * Peers import from their leaves (`core`, `wal-watcher`, `schemas`, `config`);
 * `index.ts` is a pure barrel so nothing has to reach back through it.
 * Breaks the index ↔ session-watcher ↔ agent-provider cycle (#710).
 */

export { CODEX_DB_PATH, CODEX_DB_WAL_PATH, CODEX_DIR } from "./config.ts";

export type { Logger } from "anyagent";

export {
  type CodexInfo,
  CodexInfoSchema,
  type TaskProgress,
  TaskProgressSchema,
} from "./schemas.ts";

export {
  type CodexSession,
  findSessionByDirectory,
  getThreadMetadata,
  missingThreadColumns,
  openDb,
  parseRolloutContextTokens,
  parseRolloutState,
  REQUIRED_THREAD_COLUMNS,
  type ThreadMetadata,
} from "./core.ts";

export { type CodexWatcher, createCodexWatcher } from "./session-watcher.ts";

export { subscribeCodexDb } from "./wal-watcher.ts";

export { codexProvider } from "./agent-provider.ts";

export {
  type LoadCodexTranscriptInput,
  loadCodexTranscript,
  parseCodexRollout,
} from "./transcript.ts";
