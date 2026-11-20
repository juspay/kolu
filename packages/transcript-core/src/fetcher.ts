import type { Logger } from "@kolu/log";
import type { Transcript, TranscriptPr } from "./schemas.ts";

/** Common shape every loader takes. Vendors that don't carry a value for
 *  a field receive `null`; the loader decides what a missing one means. */
export interface FetcherInput {
  sessionId: string;
  title: string | null;
  repoName: string | null;
  cwd: string | null;
  model: string | null;
  contextTokens: number | null;
  pr: TranscriptPr | null;
}

/** Synchronous (or sync-shaped) loader. Returns null when the transcript
 *  hasn't been written yet (e.g. brand-new session) or when the source
 *  store is unavailable; throws for genuinely-exceptional conditions
 *  (corrupt files, schema-incompatible DB). */
export type Fetcher = (input: FetcherInput, log?: Logger) => Transcript | null;
