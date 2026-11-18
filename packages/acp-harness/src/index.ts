/**
 * @kolu/acp-harness — one conversation with a coding agent, as a subprocess
 * that speaks ACP.
 *
 * THE PACKAGE THAT RUNS A CONVERSATION. `@kolu/acp` owns the protocol's
 * vocabulary and its pure projections and spawns nothing; `@kolu/acp-client`
 * owns one agent process and says what it said; the host owns the cell, the
 * stream and the store and speaks no ACP. This is the middle: it keeps one
 * conversation with an agent, turns what the client reports into the rows a
 * person reads, and publishes those rows and that state through the one
 * callback a caller hands in.
 *
 * IT NAMES NO PRODUCT. Both chat UIs that run an agent — kolu's Conductor and
 * olai's chat panel — run this one copy, so everything either of them knows
 * that the protocol does not arrives as an option or as the row content a verb
 * is handed ({@link ./conversation.ts}). It imports nothing of kolu's, which
 * `./noProductImports.test.ts` holds red.
 */

export {
  type Harness,
  type HarnessChange,
  type HarnessOptions,
  HarnessRefused,
  type HarnessState,
  HarnessUnavailable,
  type HttpServer,
  type Memory,
  type Opening,
  type PersonSaid,
  type Probe,
  type PromptFile,
  type SignedIn,
  type StdioServer,
  type Stored,
  startHarness,
  type ToolFrame,
  type ToolReading,
  type TurnEnded,
} from "./harness.ts";
export {
  type Held,
  type HoldingOptions,
  holding,
  joined,
  type Slot,
} from "./holding.ts";
export {
  type AnyRow,
  type Change,
  movesRows,
  type RowContent,
  type RowHead,
  type RowPatch,
  says,
  STRANDED,
  type ToolMove,
  Transcript,
  toolKey,
  type TranscriptOptions,
} from "./transcript.ts";
export { type Turn, Turns } from "./turns.ts";
