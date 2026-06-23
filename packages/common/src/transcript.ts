/** RPC contract schemas for the "Export agent session as HTML" feature.
 *
 *  The unified transcript IR (`Transcript`, `TranscriptEvent`) lives in
 *  `kolu-transcript-core` so per-agent loaders and renderers share one
 *  source of truth. kolu-common re-exports it for consumer convenience
 *  (the client and server both already import from kolu-common). */

import { z } from "zod";

export {
  type Transcript,
  type TranscriptEvent,
  TranscriptEventSchema,
  type TranscriptPr,
  TranscriptPrSchema,
  TranscriptSchema,
} from "kolu-transcript-core";

export const TranscriptHtmlModeSchema = z.enum(["chat", "full"]);
export type TranscriptHtmlMode = z.infer<typeof TranscriptHtmlModeSchema>;

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
