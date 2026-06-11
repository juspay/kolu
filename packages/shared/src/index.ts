/** Shared utilities for code that watches live external state on disk
 *  (filesystem, SQLite databases) and emits structured logs about it.
 *
 *  Generic — no agent-specific concepts. Used by `kolu-git` (HEAD watcher)
 *  and the agent integrations (Claude Code transcripts, OpenCode/Codex
 *  WAL subscriptions). The agent-specific contracts live in `anyagent`. */

export type { Logger } from "./log.ts";
export {
  type AcquirePidGateResult,
  acquirePidGate,
  type PidGate,
  pidIsAlive,
  readPidGate,
} from "./pid.ts";
export { readTailLines, type TailReadConfig } from "./tail-lines.ts";
