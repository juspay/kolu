/** Shared, domain-agnostic on-disk-state utilities, as N coherent sockets
 *  rather than one flat bag:
 *
 *   - this entry — WATCHING live external state (`readTailLines`) plus the
 *     `Logger` shape the others log through. Used by `kolu-git` (HEAD watcher)
 *     and the agent integrations (Claude Code transcripts, OpenCode/Codex WAL
 *     subscriptions).
 *   - `kolu-shared/sqlite` — reading a live SQLite database.
 *   - `kolu-shared/state-backup` — RINGING a persisted conf store (#1658).
 *
 *  Generic — no agent-specific concepts. The agent-specific contracts live in
 *  `anyagent`. */

export type { Logger } from "./log.ts";
export { readTailLines, type TailReadConfig } from "./tail-lines.ts";
