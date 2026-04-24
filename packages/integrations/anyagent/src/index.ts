/** Shared schemas, types, and utilities used by multiple integration packages.
 *  Lives here (not in kolu-common) to avoid circular dependencies:
 *  kolu-common imports from integration packages for their agent schemas,
 *  so integration packages can't import back from kolu-common. */

export { parseAgentCommand, resumeAgentCommand } from "./agent-cli.ts";

export {
  type AgentTerminalState,
  type AgentWatcher,
  type AgentInfoShape,
  type AgentProvider,
  agentInfoEqual,
  matchesAgent,
} from "./agent-provider.ts";

export { withDb, type Closable } from "./with-db.ts";

export {
  createWalSubscription,
  type WalSubscription,
  type WalSubscriptionConfig,
} from "./wal-subscription.ts";

export { readTailLines, type TailReadConfig } from "./tail-lines.ts";

export {
  TaskProgressSchema,
  type TaskProgress,
  type Logger,
} from "./schemas.ts";
