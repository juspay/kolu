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
  type Handed,
  make,
  newestFirst,
  type SignedIn,
  type StopReason,
  type Steered,
} from "./agent.ts";
/** WHAT A PROMPT IS MADE OF — the protocol's own block, re-stated as the door
 *  rather than re-declared: a caller that composes a message with a picture or
 *  a file in it has to name the shape it is composing, and the only honest
 *  name for it is ACP's. This package holds the SDK so that nothing above it
 *  has to. */
export type { ContentBlock } from "@agentclientprotocol/sdk";
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
