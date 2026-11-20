import { Schema } from "effect";
import { TRANSCRIPT_HTML_MODES } from "kolu-transcript-core";

export {
  MODE_LABEL,
  type Transcript,
  type TranscriptEvent,
  TranscriptEventSchema,
  type TranscriptHtmlMode,
  type TranscriptPr,
  TranscriptPrSchema,
  TranscriptSchema,
} from "kolu-transcript-core";

export const TranscriptHtmlModeSchema = Schema.Literals(TRANSCRIPT_HTML_MODES);

export const ExportTranscriptHtmlInputSchema = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  /** `chat` is the lightweight conversation document; `full` includes
   *  collapsed tool/reasoning audit details. */
  mode: TranscriptHtmlModeSchema,
});

export const ExportTranscriptHtmlOutputSchema = Schema.Struct({
  /** Self-contained HTML document for the requested mode. The client wraps it
   *  in a Blob and opens/downloads it — no server-side file write. */
  html: Schema.String,
  /** Suggested filename, derived from agent kind + session id + mode. */
  filename: Schema.String,
});

export type ExportTranscriptHtmlInput =
  typeof ExportTranscriptHtmlInputSchema.Type;
export type ExportTranscriptHtmlOutput =
  typeof ExportTranscriptHtmlOutputSchema.Type;
