/** Shared utilities for code that watches live external state on disk
 *  (filesystem, SQLite databases) and emits structured logs about it.
 *
 *  Generic — no agent-specific concepts. Used by `kolu-git` (HEAD watcher)
 *  and the agent integrations (Claude Code transcripts, OpenCode/Codex
 *  WAL subscriptions). The agent-specific contracts live in `anyagent`. */

export type { Logger } from "./log.ts";
export {
  listStateBackups,
  readStateBackup,
  snapshotStateFile,
  STATE_BACKUP_RING_SIZE,
  STATE_BACKUP_TICK_MS,
  startStateBackupTicker,
  stateBackupDir,
  type StateBackupEntry,
  stateBackupPath,
  type SnapshotOutcome,
} from "./stateBackup.ts";
export { readTailLines, type TailReadConfig } from "./tail-lines.ts";
