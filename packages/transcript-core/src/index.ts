/** Vendor-neutral transcript IR + the contract every integration loader
 *  implements + the structural transforms applied before render.
 *
 *  Lowy: this is the bounded context "transcript modeling". Vendor wire
 *  formats (the per-integration loaders) are the volatile axis kept on
 *  the other side of `Fetcher`. Renderers (kolu-transcript-html today,
 *  others later) consume IR; they don't redefine it. */

export {
  AGENT_KINDS,
  type AgentKindLiteral,
  type ToolInput,
  ToolInputSchema,
  type Transcript,
  type TranscriptEvent,
  TranscriptEventSchema,
  type TranscriptPr,
  TranscriptPrSchema,
  TranscriptSchema,
} from "./schemas.ts";

export { parseIsoTimestamp } from "./timestamp.ts";

export { type Fetcher, type FetcherInput, type Logger } from "./fetcher.ts";

export {
  makeRelativizer,
  relativizeTranscript,
  type StringTransform,
  transformStrings,
} from "./transform.ts";
