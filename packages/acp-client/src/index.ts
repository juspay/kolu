/**
 * `@kolu/acp-client` — one agent process speaking ACP, typed events out.
 *
 * The door is what a product that holds conversations on top of the client
 * imports: `make` and the `Agent` it returns, the events it reports, why it
 * gave up, the interfaces its options take, and the probes of the MCP servers
 * it hands a session.
 */

export {
  type Advertised,
  type Agent,
  AgentGone,
  type Gone,
  make,
  newestFirst,
  type StopReason,
  type ToolServer,
} from "./agent.ts";
export type { AgentEvent, Stored } from "./events.ts";
export {
  type Conversing,
  type Memory,
  MemoryFailure,
  type MemorySnapshot,
  type Models,
} from "./memory.ts";
export type { Probe, Probed, StdioServer } from "./probes.ts";
export { AnswerRefused } from "./questions.ts";
