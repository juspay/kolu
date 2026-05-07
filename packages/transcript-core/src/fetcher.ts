/** Explicit contract every integration's transcript loader implements.
 *
 *  Each vendor's `loadXxxTranscript` function is typed as `Fetcher` so the
 *  seam between core and integrations is mechanical, not implicit. The
 *  router dispatches on `agentKind`; each branch calls a `Fetcher` and
 *  gets a `Transcript | null` back. */

import type { Transcript, TranscriptPr } from "./schemas.ts";

/** Logger interface accepted by integration library functions.
 *  Structurally compatible with pino child loggers — the server creates
 *  a `log.child(...)` and passes it through. Re-declared here (instead
 *  of imported from `anyagent`) so transcript-core has zero deps on
 *  integration-side packages. */
export type Logger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

/** Common shape every loader takes. Vendors that don't carry a value for
 *  a field receive `null`; the loader decides what to do (e.g. claude-code
 *  needs a non-null cwd to encode the projects-dir path and returns null
 *  when cwd is missing, mirroring the "transcript not yet written"
 *  branch). */
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
