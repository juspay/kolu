/** Zod schemas for Codex session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which imports `node:sqlite`
 *  via `DatabaseSync`. Mirrors the `kolu-github/schemas` precedent. See
 *  juspay/kolu#682.
 *
 *  Anything exported here MUST stay free of `node:*` imports and filesystem
 *  access — zod and `anyagent`'s schema re-exports only. */

import { z } from "zod";
import { TaskProgressSchema } from "anyagent";

export { TaskProgressSchema };
export type { TaskProgress } from "anyagent";

export const CodexInfoSchema = z.object({
  kind: z.literal("codex"),
  /** Current state derived from the rollout JSONL's event stream. */
  state: z.enum(["thinking", "tool_use", "waiting"]),
  /** Thread id from Codex's `threads` table (e.g. "019db605-..."). */
  sessionId: z.string(),
  /** Model identifier from the DB (e.g. "gpt-5.4"). Null until Codex
   *  writes the first turn_context. */
  model: z.string().nullable(),
  /** Thread display title from the DB. Codex seeds this with the first
   *  user message, then replaces with a short generated name after
   *  the first exchange. */
  summary: z.string().nullable(),
  /** Codex has no TodoWrite equivalent — the `task_started`/`task_complete`
   *  events are per-turn lifecycle, not user-facing checklists.
   *  Permanently null; the field is kept for union shape uniformity. */
  taskProgress: TaskProgressSchema.nullable(),
  /** Running context-window token count from `threads.tokens_used` —
   *  pre-summed by Codex from the latest `token_count` event's
   *  `info.total_token_usage.total_tokens`. Null on a brand-new thread
   *  before the first assistant turn accounts. */
  contextTokens: z.number().nullable(),
});

export type CodexInfo = z.infer<typeof CodexInfoSchema>;
