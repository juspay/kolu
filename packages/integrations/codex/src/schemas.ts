/** Effect Schema definitions for Codex session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which imports `node:sqlite`
 *  via `DatabaseSync`. Mirrors the `anyforge/schemas` precedent. See
 *  juspay/kolu#682.
 *
 *  Anything exported here MUST stay free of `node:*` imports and filesystem
 *  access — Effect Schema and `anyagent`'s schema re-exports only. */

import { TaskProgressSchema } from "anyagent";
import { Schema } from "effect";

export type { TaskProgress } from "anyagent";
export { TaskProgressSchema };

export const CodexInfoSchema = Schema.Struct({
  kind: Schema.Literal("codex"),
  /** Current state derived from the rollout JSONL's event stream.
   *  - `awaiting_user`: agent issued `request_user_input` (or another
   *    user-input tool) and is blocked on a reply. Distinct from `tool_use`
   *    so the UI can stop pretending the spinner is doing work. */
  state: Schema.Literals(["thinking", "tool_use", "waiting", "awaiting_user"]),
  /** Thread id from Codex's `threads` table (e.g. "019db605-..."). */
  sessionId: Schema.String,
  /** Model identifier from the DB (e.g. "gpt-5.4"). Null until Codex
   *  writes the first turn_context. */
  model: Schema.NullOr(Schema.String),
  /** Thread display title from the DB. Codex seeds this with the first
   *  user message, then replaces with a short generated name after
   *  the first exchange. */
  summary: Schema.NullOr(Schema.String),
  /** Codex has no TodoWrite equivalent — the `task_started`/`task_complete`
   *  events are per-turn lifecycle, not user-facing checklists.
   *  Permanently null; the field is kept for union shape uniformity. */
  taskProgress: Schema.NullOr(TaskProgressSchema),
  /** Running context-window token count from `threads.tokens_used` —
   *  pre-summed by Codex from the latest `token_count` event's
   *  `info.total_token_usage.total_tokens`. Null on a brand-new thread
   *  before the first assistant turn accounts. */
  contextTokens: Schema.NullOr(Schema.Number),
  /** Epoch-ms the thread was created — decoded from the uuidv7 thread id's
   *  leading 48-bit timestamp (no extra read; the id is already in hand).
   *  Null if the id isn't a uuidv7 we can decode. Drives the inspector's
   *  "Running for" elapsed display. */
  startedAt: Schema.NullOr(Schema.Number),
});

export type CodexInfo = typeof CodexInfoSchema.Type;
