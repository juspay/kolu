/** Effect Schema definitions for Pi session info — browser-safe.
 *
 *  Lives in its own module so `@kolu/terminal-vocab` (and any client code)
 *  can import the schema without pulling the package root, which imports
 *  `node:fs`. Mirrors the `kolu-grok/schemas` precedent.
 *
 *  Anything exported here MUST stay free of `node:*` imports and filesystem
 *  access — Effect Schema and `anyagent`'s schema re-exports only. */

import { TaskProgressSchema } from "anyagent";
import { Schema } from "effect";

export type { TaskProgress } from "anyagent";
export { TaskProgressSchema };

export const PiInfoSchema = Schema.Struct({
  kind: Schema.Literal("pi"),
  /** Current state derived from the session transcript's tail.
   *  - `tool_use`: newest assistant message ended `stopReason: "toolUse"`.
   *  - `thinking`: newest entry is a user prompt or tool result — the model
   *    has been re-invoked or is mid-turn (pi persists an assistant message
   *    only when that message completes, so a quiet tail mid-turn reads
   *    thinking, never a stale tool_use).
   *  - `waiting`: newest assistant message ended `stop` / `length` / `error`
   *    / `aborted` — the turn ended, the agent is idle at its prompt.
   *  No `awaiting_user`: pi's permission gates and questions are TUI
   *  dialogs that never land in the session JSONL, so there is no on-disk
   *  signal an awaiting state could derive from. Declaring the literal here
   *  would paint a state the fold can never produce. */
  state: Schema.Literals(["thinking", "tool_use", "waiting"]),
  /** Session UUID from the transcript filename (`<timestamp>_<uuid>.jsonl`,
   *  the same identifier pi's own session listing derives). */
  sessionId: Schema.String,
  /** Absolute path of the session's transcript file — the resume ref pi
   *  accepts VERBATIM (`pi --session <path>`), bypassing pi's session-store
   *  resolution entirely: an id alone is unfindable from a fresh pi once the
   *  store moved (a harness's per-run `PI_CODING_AGENT_DIR`, or a
   *  `--session-dir`); the path opens regardless. Optional — older producers
   *  carry no path. */
  sessionPath: Schema.optional(Schema.String),
  /** Model identifier from the newest assistant message's `message.model`
   *  (e.g. "claude-sonnet-4-5"), or the latest `model_change` entry when the
   *  session has no assistant turn yet. Null until either lands. */
  model: Schema.NullOr(Schema.String),
  /** Display title from the newest `session_info` entry — the name the user
   *  set via `--name` / `/name`. Null when the session is unnamed (pi falls
   *  back to the first message in its own picker; deriving that here would
   *  fabricate a title pi itself does not record). */
  summary: Schema.NullOr(Schema.String),
  /** Pi has no todo-list primitive — permanently null; the field is kept
   *  for union shape uniformity. */
  taskProgress: Schema.NullOr(TaskProgressSchema),
  /** Running context-window token count from the newest assistant message's
   *  `usage.input + cacheRead + cacheWrite` — the same "full context the
   *  model saw" sum Claude Code derives from its three disjoint buckets
   *  (`input_tokens` here is NOT already inclusive of the cache reads, so
   *  the sum does not double-count — unlike Codex's OpenAI-shaped usage).
   *  Null before the first assistant turn accounts. */
  contextTokens: Schema.NullOr(Schema.Number),
  /** Epoch-ms the session began — the transcript filename's timestamp (pi
   *  names the file at creation; immutable for the life of the session, so
   *  it survives a `pi -c` resume, which appends to the same file). Null if
   *  the filename carried no parseable timestamp. Drives the inspector's
   *  "Running for" elapsed display. */
  startedAt: Schema.NullOr(Schema.Number),
});

export type PiInfo = typeof PiInfoSchema.Type;
