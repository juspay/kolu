/** Zod schemas for Grok session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which imports `node:fs`.
 *  Mirrors the `kolu-codex/schemas` precedent. */

import { TaskProgressSchema } from "anyagent";
import { z } from "zod";

export type { TaskProgress } from "anyagent";
export { TaskProgressSchema };

export const GrokInfoSchema = z.object({
  kind: z.literal("grok"),
  /** Current state derived from the session's `events.jsonl` stream.
   *  - `awaiting_user`: last phase is `permission_prompt` (blocked on reply).
   *  - `tool_use`: last phase is `tool_execution`.
   *  - `thinking`: model wait / streaming reasoning or text.
   *  - `waiting`: turn ended, no open turn. */
  state: z.enum(["thinking", "tool_use", "waiting", "awaiting_user"]),
  /** Session UUID from `summary.info.id` / `active_sessions.session_id`. */
  sessionId: z.string(),
  /** Model id from `summary.current_model_id` (e.g. "grok-4.5"). Null until
   *  the summary is written. */
  model: z.string().nullable(),
  /** Display title from `generated_title` or `session_summary`. */
  summary: z.string().nullable(),
  /** Grok plan checklist is not yet a stable first-class count — permanently
   *  null in v1 so the field stays honest. */
  taskProgress: TaskProgressSchema.nullable(),
  /** No stable context-window counter in the on-disk session format yet —
   *  permanently null in v1 (do not invent from `num_messages`). */
  contextTokens: z.number().nullable(),
  /** Epoch-ms the session was created (`summary.created_at`). Null if
   *  unparseable. Drives the inspector's "Running for" display. */
  startedAt: z.number().nullable(),
});

export type GrokInfo = z.infer<typeof GrokInfoSchema>;
