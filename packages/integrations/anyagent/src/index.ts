/** Agent contracts shared across integration packages.
 *
 *  Owns: the `AgentAdapter` contract, terminal-state matching, the
 *  `AgentVocab`/`AgentPlugin` vocabulary contracts, agent CLI parsing, and the
 *  cross-integration TaskProgress schema.
 *
 *  Generic utilities (Logger, file/DB helpers, WAL subscription factory)
 *  live in `@kolu/log` — agent integrations and `kolu-git` import them
 *  from there. This package is for code that has agent-specific concerns...
 *  BUT the kernel names no agent: the vocabulary SHAPE and CLI ALGORITHMS live
 *  here, the per-agent DATA lives in each `kolu-<agent>` package, and the
 *  registry that lists them lives in `kolu-agents`. */

export {
  type AgentAdapter,
  type AgentInfoShape,
  type AgentTerminalState,
  type AgentWatcher,
  agentInfoEqual,
  matchesAgent,
} from "./agent-adapter.ts";
export {
  type AgentCliRegistry,
  agentKindFromCommand,
  agentNameFromCommand,
  buildCliRegistry,
  exactRestoreTarget,
  parseAgentCommand,
  resumableCommand,
  resumeAgentCommand,
  resumeFormFor,
} from "./agent-cli.ts";
export { classifyByAwaiting } from "./lifecycle.ts";
export type { AgentPlugin } from "./plugin.ts";
export { type TaskProgress, TaskProgressSchema } from "./schemas.ts";
export type {
  AgentCliGrammar,
  AgentMark,
  AgentResumePolicy,
  AnyAgentVocab,
  AgentVocab,
  FlagArity,
} from "./vocab.ts";
