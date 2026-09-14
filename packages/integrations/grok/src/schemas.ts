/** Effect Schema definitions for Grok session info — browser-safe.
 *
 *  Lives in its own module so `kolu-common` (and any client code) can import
 *  the schema without pulling the package root, which imports `node:fs`.
 *  Mirrors the `kolu-codex/schemas` precedent. */

import { type AgentVocab, type FlagArity, TaskProgressSchema } from "anyagent";
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

/** Grok comet mark — lobehub icon set (xAI/grok is not in simple-icons), 24×24.
 *  ONE mark for both the tile-chrome icon and the dock pip. */
const GROK_MARK = {
  viewBox: "0 0 24 24",
  paint: "fill" as const,
  paths: [
    "M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815",
  ],
};

/** Grok Build's vocabulary — display name, brand mark, CLI grammar, resume
 *  policy, and wire schema. */
export const grokVocab: AgentVocab<GrokInfo> = {
  kind: "grok",
  displayName: "Grok",
  mark: GROK_MARK,
  cli: {
    basename: "grok",
    stableFlags: new Map<string, FlagArity>([
      ["--model", "value"],
      ["-m", "value"],
      ["--always-approve", "boolean"],
      ["--permission-mode", "value"],
      ["--agent", "value"],
      ["--no-plan", "boolean"],
      ["--no-subagents", "boolean"],
      // Inline (scrollback) TUI instead of the alternate screen — a launch-shape
      // choice users re-pick deliberately; must survive recent-agents / resume.
      ["--no-alt-screen", "boolean"],
      ["--reasoning-effort", "value"],
      ["--effort", "value"],
    ]),
    extraExitFlags: new Set<string>(),
    nonSessionFlags: new Set<string>(),
    nonSessionSubcommands: new Set<string>(),
  },
  resume: {
    last: "-c",
    byId: (id) => `--resume ${id}`,
    idPattern:
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    ref: (info) => info.sessionId,
  },
  infoSchema: GrokInfoSchema,
};
