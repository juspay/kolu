/** RPC contract schemas for the "Export agent session as HTML" feature.
 *
 *  The unified transcript IR (`Transcript`, `TranscriptEvent`) lives in
 *  `anyagent/schemas` so per-agent loaders can produce it without
 *  importing back through this package (which would be a cycle —
 *  kolu-common already imports from each `kolu-<agent>/schemas`). The
 *  RPC input/output schemas stay here, where the contract itself does. */

import { z } from "zod";

export {
  type Transcript,
  type TranscriptEvent,
  TranscriptEventSchema,
  type TranscriptPr,
  TranscriptPrSchema,
  TranscriptSchema,
} from "anyagent/schemas";

export const ExportTranscriptHtmlInputSchema = z.object({
  id: z.string().uuid(),
});

export const ExportTranscriptHtmlOutputSchema = z.object({
  /** Full self-contained HTML document. The client wraps it in a Blob
   *  and opens it in a new tab — no server-side file write. */
  html: z.string(),
  /** Suggested filename for "Save Page As…", derived from agent kind +
   *  session id. */
  filename: z.string(),
});

export type ExportTranscriptHtmlInput = z.infer<
  typeof ExportTranscriptHtmlInputSchema
>;
export type ExportTranscriptHtmlOutput = z.infer<
  typeof ExportTranscriptHtmlOutputSchema
>;
