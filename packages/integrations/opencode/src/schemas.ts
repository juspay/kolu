/** Effect Schema definitions for OpenCode session info — browser-safe.
 *
 *  Anything exported here MUST stay free of `node:*` imports and filesystem
 *  access — `effect`'s Schema and `anyagent`'s schema re-exports only
 *  (juspay/kolu#682). */

import {
  type AgentVocab,
  type FlagArity,
  NODE_CLI_SHIMS,
  TaskProgressSchema,
} from "anyagent";
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
  /** OpenCode 2.x writes no todo table (1.x's `todo` froze at the
   *  cutover) — permanently null; the field is kept for union shape
   *  uniformity. */
  taskProgress: Schema.NullOr(TaskProgressSchema),
  /** Context-window token count, as OpenCode's own TUI computes it: the
   *  newest accounted assistant step's `input + output + reasoning +
   *  cache.read + cache.write` (see `getLatestAssistantFacts`). Null until
   *  the agent has produced an accounted assistant step. */
  contextTokens: Schema.NullOr(Schema.Number),
  /** Epoch-ms the session began — the `time_created` of its earliest
   *  message (one indexed query). Null until the first message lands.
   *  Drives the inspector's "Running for" elapsed display. */
  startedAt: Schema.NullOr(Schema.Number),
});

export type OpenCodeInfo = typeof OpenCodeInfoSchema.Type;

const OPENCODE_MARK = {
  viewBox: "0 0 24 24",
  paint: "fill" as const,
  paths: ["M22 24H2V0h20zM17 4.8H7v14.4h10z"],
};

export const opencodeVocab: AgentVocab<OpenCodeInfo> = {
  kind: "opencode",
  displayName: "OpenCode",
  mark: OPENCODE_MARK,
  cli: {
    basename: "opencode",
    shims: NODE_CLI_SHIMS,
    stableFlags: new Map<string, FlagArity>([
      ["--model", "value"],
      ["--dangerously-skip-permissions", "boolean"],
      ["--yolo", "boolean"],
      ["--agent", "value"],
      ["--pure", "boolean"],
    ]),
  },
  resume: {
    byId: (id) => `--session ${id}`,
    idPattern: /^ses_[0-9a-zA-Z]{1,64}$/,
    ref: (info) => info.sessionId,
  },
  // Measured: `opencode` 2.2.7 in a kolu terminal on 2026-11-13. Idle, text
  // plus one Enter submits. WHILE WORKING, the message is accepted (the
  // composer clears and the row appears under the running answer) but the
  // generation carries on to its end untouched — opencode holds it for the
  // next turn, so it is a queue, not a steer.
  say: {
    idle: ["Enter"],
    working: { keys: ["Enter"], delivery: "queue" },
    verified: "ran opencode 2.2.7 in a kolu terminal, 2026-11-13",
  },
  infoSchema: OpenCodeInfoSchema,
};
