/** RPC contract schemas for the "Export agent session as HTML" feature.
 *
 *  The unified transcript IR (`Transcript`, `TranscriptEvent`) lives in
 *  `kolu-transcript-core` so per-agent loaders and renderers share one
 *  source of truth. kolu-common re-exports it for consumer convenience
 *  (the client and server both already import from kolu-common). */

import { z } from "zod";

import { TRANSCRIPT_HTML_MODES } from "kolu-transcript-core";

export {
  type Transcript,
  type TranscriptEvent,
  TranscriptEventSchema,
  type TranscriptHtmlMode,
  type TranscriptPr,
  TranscriptPrSchema,
  TranscriptSchema,
} from "kolu-transcript-core";

/** Derived from the canonical mode list in kolu-transcript-core so the RPC
 *  contract and the renderer provably agree on one value set. */
export const TranscriptHtmlModeSchema = z.enum(TRANSCRIPT_HTML_MODES);

export const ExportTranscriptHtmlInputSchema = z.object({
  id: z.string().uuid(),
  /** `chat` is the lightweight conversation document; `full` includes
   *  collapsed tool/reasoning audit details. */
  mode: TranscriptHtmlModeSchema,
});

export const ExportTranscriptHtmlOutputSchema = z.object({
  /** Self-contained HTML document for the requested mode. The client wraps it
   *  in a Blob and opens/downloads it — no server-side file write. */
  html: z.string(),
  /** Suggested filename, derived from agent kind + session id + mode. */
  filename: z.string(),
});

export type ExportTranscriptHtmlInput = z.infer<
  typeof ExportTranscriptHtmlInputSchema
>;
export type ExportTranscriptHtmlOutput = z.infer<
  typeof ExportTranscriptHtmlOutputSchema
>;
