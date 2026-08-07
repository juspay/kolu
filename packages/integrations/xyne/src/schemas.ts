/** Effect Schema definitions for Xyne session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which imports `node:fs`.
 *  Mirrors the `kolu-grok/schemas` precedent. */

import { TaskProgressSchema } from "anyagent";
import { Schema } from "effect";

export type { TaskProgress } from "anyagent";
export { TaskProgressSchema };

export const XyneInfoSchema = Schema.Struct({
  kind: Schema.Literal("xyne"),
  /** Xyne's JSONL transcript carries no live phase events (only persisted
   *  message history), so no busy/attention distinction is derivable —
   *  permanently `waiting` so the tile can carry the Xyne badge + summary.
   *  A `Literal` rather than a single-value struct: the value cannot expand
   *  here without a deliberate schema change, and the terminal-vocab arm's
   *  structural check still holds. */
  state: Schema.Literal("waiting"),
  /** Session UUID from the transcript's `{"type":"session"}` header entry
   *  (also the `<id>` in the transcript filename). */
  sessionId: Schema.String,
  /** Provider/model id from the transcript's latest `model_change` entry.
   *  Null when the session never recorded one. */
  model: Schema.NullOr(Schema.String),
  /** Display title from the transcript's sidecar `*_summary.json`. */
  summary: Schema.NullOr(Schema.String),
  /** Xyne exposes no task checklist on disk — permanently null so the field
   *  stays honest. */
  taskProgress: Schema.NullOr(TaskProgressSchema),
  /** Xyne exposes no context-window telemetry on disk — permanently null so
   *  the field stays honest. */
  contextTokens: Schema.NullOr(Schema.Number),
  /** Epoch-ms the session began (the transcript header's `timestamp`).
   *  Survives a resume; drives the inspector's "Running for" display. */
  startedAt: Schema.NullOr(Schema.Number),
});

export type XyneInfo = typeof XyneInfoSchema.Type;
