/** Effect Schema definitions for OpenCode session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which imports `node:sqlite`
 *  via `DatabaseSync`. Mirrors the `anyforge/schemas` precedent. See
 *  juspay/kolu#682.
 *
 *  Anything exported here MUST stay free of `node:*` imports and filesystem
 *  access — `effect`'s Schema and `anyagent`'s schema re-exports only. */

import { TaskProgressSchema } from "anyagent";
import { Schema } from "effect";

export type { TaskProgress } from "anyagent";
export { TaskProgressSchema };

export const OpenCodeInfoSchema = Schema.Struct({
  kind: Schema.Literal("opencode"),
  /** Current state derived from the latest session message.
   *  - `awaiting_user`: the only running tool part is OpenCode's `question`
   *    tool (blocked on user reply). Distinct from `tool_use` so the UI can
   *    stop pretending the spinner is doing work. */
  state: Schema.Literals(["thinking", "tool_use", "waiting", "awaiting_user"]),
  /** Session ID from OpenCode's database (e.g. "ses_..."). */
  sessionId: Schema.String,
  /** Model identifier if available (e.g. "litellm/glm-latest"). */
  model: Schema.NullOr(Schema.String),
  /** Session title from OpenCode. */
  summary: Schema.NullOr(Schema.String),
  /** Todo progress from OpenCode's `todo` table. null when no todos. */
  taskProgress: Schema.NullOr(TaskProgressSchema),
  /** Running context-window token count from the latest assistant
   *  message's `tokens.total` field (OpenCode emits it pre-summed).
   *  Null when the latest message is a user turn or the agent has not
   *  yet produced an assistant reply. */
  contextTokens: Schema.NullOr(Schema.Number),
  /** Epoch-ms the session began — the `time_created` of its earliest
   *  message (one indexed query). Null until the first message lands.
   *  Drives the inspector's "Running for" elapsed display. */
  startedAt: Schema.NullOr(Schema.Number),
});

export type OpenCodeInfo = typeof OpenCodeInfoSchema.Type;
