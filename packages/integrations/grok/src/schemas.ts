/** Effect Schema definitions for Grok session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which imports `node:fs`.
 *  Mirrors the `kolu-codex/schemas` precedent. */

import { TaskProgressSchema } from "anyagent";
import { Schema } from "effect";

export type { TaskProgress } from "anyagent";
export { TaskProgressSchema };

export const GrokInfoSchema = Schema.Struct({
  kind: Schema.Literal("grok"),
  /** Current state derived from the session's `events.jsonl` stream.
   *  - `awaiting_user`: open `ask_user_question` tool, or last phase
   *    `permission_prompt` (blocked on the human).
   *  - `tool_use`: last phase is `tool_execution` (and no open ask-user tool).
   *  - `thinking`: model wait / streaming reasoning or text.
   *  - `waiting`: turn ended, no open turn. */
  state: Schema.Literals(["thinking", "tool_use", "waiting", "awaiting_user"]),
  /** Session UUID from `summary.info.id` / `active_sessions.session_id`. */
  sessionId: Schema.String,
  /** Model id from `summary.current_model_id` (e.g. "grok-4.5"). Null until
   *  the summary is written. */
  model: Schema.NullOr(Schema.String),
  /** Display title from `generated_title` or `session_summary`. */
  summary: Schema.NullOr(Schema.String),
  /** Grok plan checklist is not yet a stable first-class count — permanently
   *  null so the field stays honest until `updates.jsonl` plan events are
   *  pinned. */
  taskProgress: Schema.NullOr(TaskProgressSchema),
  /** Running context-window token count from `signals.json`
   *  (`contextTokensUsed`). Null until signals land or the field is absent. */
  contextTokens: Schema.NullOr(Schema.Number),
  /** Epoch-ms the session was created (`summary.created_at`). Null if
   *  unparseable. Drives the inspector's "Running for" display. */
  startedAt: Schema.NullOr(Schema.Number),
});

export type GrokInfo = typeof GrokInfoSchema.Type;
