/** Zod schemas for OpenCode session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which imports `node:sqlite`
 *  via `DatabaseSync`. Mirrors the `kolu-github/schemas` precedent. See
 *  juspay/kolu#682.
 *
 *  Anything exported here MUST stay free of `node:*` imports and filesystem
 *  access — zod and `anyagent`'s schema re-exports only. */

import { TaskProgressSchema } from "anyagent";
import { z } from "zod";

export type { TaskProgress } from "anyagent";
export { TaskProgressSchema };

export const OpenCodeInfoSchema = z.object({
  kind: z.literal("opencode"),
  /** Current state derived from the latest session message. */
  state: z.enum(["thinking", "tool_use", "waiting"]),
  /** Session ID from OpenCode's database (e.g. "ses_..."). */
  sessionId: z.string(),
  /** Model identifier if available (e.g. "litellm/glm-latest"). */
  model: z.string().nullable(),
  /** Session title from OpenCode. */
  summary: z.string().nullable(),
  /** Todo progress from OpenCode's `todo` table. null when no todos. */
  taskProgress: TaskProgressSchema.nullable(),
  /** Running context-window token count from the latest assistant
   *  message's `tokens.total` field (OpenCode emits it pre-summed).
   *  Null when the latest message is a user turn or the agent has not
   *  yet produced an assistant reply. */
  contextTokens: z.number().nullable(),
});

export type OpenCodeInfo = z.infer<typeof OpenCodeInfoSchema>;
