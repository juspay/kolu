/** Agent contracts shared across integration packages.
 *
 *  Owns: AgentProvider contract, terminal-state matching, agent CLI
 *  parsing, and the cross-integration TaskProgress schema.
 *
 *  Generic utilities (Logger, file/DB helpers, WAL subscription factory)
 *  live in `kolu-shared` — agent integrations and `kolu-git` import them
 *  from there. This package is for code that has agent-specific concerns. */

export {
  agentNameFromCommand,
  parseAgentCommand,
  resumeAgentCommand,
} from "./agent-cli.ts";

export {
  type AgentInfoShape,
  type AgentProvider,
  type AgentTerminalState,
  type AgentWatcher,
  agentInfoEqual,
  matchesAgent,
} from "./agent-provider.ts";
export { classifyByAwaiting } from "./lifecycle.ts";
export { type TaskProgress, TaskProgressSchema } from "./schemas.ts";
