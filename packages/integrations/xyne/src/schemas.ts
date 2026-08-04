/** Zod schemas for Xyne session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which imports `node:fs`.
 *  Mirrors the `kolu-grok/schemas` precedent. */

import { TaskProgressSchema } from "anyagent";
import { z } from "zod";

export type { TaskProgress } from "anyagent";
export { TaskProgressSchema };

export const XyneInfoSchema = z.object({
  kind: z.literal("xyne"),
  /** Xyne's JSONL transcript carries no live phase events (only persisted
   *  message history), so no busy/attention distinction is derivable —
   *  permanently `waiting` so the tile can carry the Xyne badge + summary.
   *  A `literal` rather than a single-value enum: the value cannot expand
   *  here without a deliberate schema change, and the terminal-vocab arm's
   *  structural check still holds. */
  state: z.literal("waiting"),
  /** Session UUID from the transcript's `{"type":"session"}` header entry
   *  (also the `<id>` in the transcript filename). */
  sessionId: z.string(),
  /** Provider/model id from the transcript's latest `model_change` entry.
   *  Null when the session never recorded one. */
  model: z.string().nullable(),
  /** Display title from the transcript's sidecar `*_summary.json`. */
  summary: z.string().nullable(),
  /** Xyne exposes no task checklist on disk — permanently null so the field
   *  stays honest. */
  taskProgress: TaskProgressSchema.nullable(),
  /** Xyne exposes no context-window telemetry on disk — permanently null so
   *  the field stays honest. */
  contextTokens: z.number().nullable(),
  /** Epoch-ms the session began (the transcript header's `timestamp`).
   *  Survives a resume; drives the inspector's "Running for" display. */
  startedAt: z.number().nullable(),
});

export type XyneInfo = z.infer<typeof XyneInfoSchema>;
