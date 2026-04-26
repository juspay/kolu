/** Shared schemas, types, and utilities used by multiple integration packages.
 *  Lives here (not in kolu-common) to avoid circular dependencies:
 *  kolu-common imports from integration packages for their agent schemas,
 *  so integration packages can't import back from kolu-common. */

export { parseAgentCommand, resumeAgentCommand } from "./agent-cli.ts";

export {
  type AgentInfoShape,
  type AgentProvider,
  type AgentTerminalState,
  type AgentWatcher,
  agentInfoEqual,
  matchesAgent,
} from "./agent-provider.ts";
export {
  AGENT_KINDS,
  type AgentKindLiteral,
  type Logger,
  parseIsoTimestamp,
  type TaskProgress,
  TaskProgressSchema,
  type Transcript,
  type TranscriptEvent,
  TranscriptEventSchema,
  TranscriptSchema,
} from "./schemas.ts";
export { readTailLines, type TailReadConfig } from "./tail-lines.ts";
export {
  createWalSubscription,
  type WalSubscription,
  type WalSubscriptionConfig,
} from "./wal-subscription.ts";
export { type Closable, withDb } from "./with-db.ts";
