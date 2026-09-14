/** Effect Schema definitions for Xyne session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which imports `node:fs`.
 *  Mirrors the `kolu-grok/schemas` precedent. */

import { type AgentVocab, TaskProgressSchema } from "anyagent";
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

/** Canonical UUID shape — xyne's session ids (and claude's / codex's) are
 *  plain UUIDs; the shell-inert gate a ref must pass before `--session`
 *  splices it (fail-closed, see `AgentResumePolicy.idPattern`). */
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Xyne "X" monogram — xyne-cli ships no brand mark in simple-icons, so a
 *  bold geometric X stands in; weight matched to the other filled marks.
 *  ONE mark for both the tile-chrome icon and the dock pip. */
const XYNE_MARK = {
  viewBox: "0 0 24 24",
  paint: "fill" as const,
  paths: [
    "M5.04 3h4.05L12 9.27 14.91 3h4.05l-4.74 9L18.96 21h-4.05L12 14.73 9.09 21H5.04l4.74-9L5.04 3z",
  ],
};

/** Xyne's vocabulary — display name, brand mark, CLI grammar, resume policy,
 *  and wire schema. */
export const xyneVocab: AgentVocab<XyneInfo> = {
  kind: "xyne",
  displayName: "Xyne",
  mark: XYNE_MARK,
  cli: {
    basename: "xyne",
    stableFlags: new Map([
      ["--debug", "boolean"],
      ["--port", "value"],
    ]),
    extraExitFlags: new Set(),
    nonSessionFlags: new Set(),
    nonSessionSubcommands: new Set(),
  },
  resume: {
    // Xyne: `--continue` for most-recent in cwd; `--session <uuid>` for exact
    // (both forms accepted upstream — cli-parser takes space-separated too).
    last: "--continue",
    byId: (id) => `--session ${id}`,
    idPattern: UUID_RE,
    ref: (info) => info.sessionId,
  },
  infoSchema: XyneInfoSchema,
};
