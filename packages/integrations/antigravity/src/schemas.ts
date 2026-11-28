/** Effect Schema definitions for Antigravity CLI session info — browser-safe.
 *
 *  Lives in its own module so the registry (and any client code) can import
 *  the schema without pulling the package root, which imports `node:fs`.
 *
 *  Anything exported here MUST stay free of `node:*` imports and filesystem
 *  access — Effect Schema and `anyagent`'s schema re-exports only. */

import {
  type AgentVocab,
  type FlagArity,
  TaskProgressSchema,
  UUID_RE,
} from "anyagent";
import { Schema } from "effect";

export type { TaskProgress } from "anyagent";
export { TaskProgressSchema };

export const AntigravityInfoSchema = Schema.Struct({
  kind: Schema.Literal("antigravity"),
  /** From the transcript's last line, except `awaiting_user`:
   *  - `thinking`: a user line, a system line or a tool's result is last —
   *    `agy` writes the model's answer whole, only when it is finished.
   *  - `tool_use`: a model answer carrying `tool_calls` is last — it lands
   *    before the tool runs and stays last while it runs.
   *  - `waiting`: a model answer without `tool_calls` is last; the turn ended.
   *  - `awaiting_user`: read off the screen — a permission menu `agy` paints
   *    while the tool call is on disk (`screen.ts`).
   *  Nothing is written when a turn is interrupted, so the state the
   *  transcript last showed stays until the next prompt. */
  state: Schema.Literals(["thinking", "tool_use", "waiting", "awaiting_user"]),
  /** The conversation id: a UUID, the name of its `brain/` directory. */
  sessionId: Schema.String,
  /** The newest model answer's `model` — the slug `--model` takes. */
  model: Schema.NullOr(Schema.String),
  /** The conversation's own title, from `annotations/<id>.pbtxt`. Null when
   *  the file is absent or is not the one `title:"…"` line. */
  summary: Schema.NullOr(Schema.String),
  /** `agy` writes no task checklist kolu can read — permanently null. */
  taskProgress: Schema.NullOr(TaskProgressSchema),
  /** The newest model answer's `input_tokens + cache_read_tokens` — two
   *  disjoint counts, so the sum is the context the model saw. */
  contextTokens: Schema.NullOr(Schema.Number),
  /** Epoch-ms of the transcript's first line (`created_at`). Survives a
   *  resume, which appends to the same transcript. */
  startedAt: Schema.NullOr(Schema.Number),
});

export type AntigravityInfo = typeof AntigravityInfoSchema.Type;

/** Antigravity "A" monogram, 24×24. Google's press page publishes its icon
 *  files without terms for use inside another product, so a plain letterform
 *  stands in; weight matched to the other filled marks. ONE mark for both the
 *  tile-chrome icon and the dock pip. */
const ANTIGRAVITY_MARK = {
  viewBox: "0 0 24 24",
  paint: "fill" as const,
  paths: [
    "M12 3l9.5 18h-2.42l-1.69-3.2H6.61L4.92 21H2.5L12 3zm0 4.6l-3.7 7h7.4L12 7.6z",
  ],
};

/** Antigravity CLI's vocabulary — display name, brand mark, CLI grammar,
 *  resume policy, and wire schema. */
export const antigravityVocab: AgentVocab<AntigravityInfo> = {
  kind: "antigravity",
  displayName: "Antigravity CLI",
  mark: ANTIGRAVITY_MARK,
  cli: {
    // A Go binary: the kernel names `agy` itself, so no interpreter hides it.
    basename: "agy",
    shims: new Set(),
    // `agy` remembers none of its flags across a resume — a session started in
    // `--mode accept-edits` comes back in the default mode unless the flag is
    // passed again. Left out on purpose: the conversation pickers (`-c`,
    // `--conversation`, `-r`, `--resume`), `--new-project`,
    // `--remote-control`, `--log-file` and the print-mode flags.
    stableFlags: new Map<string, FlagArity>([
      ["--mode", "value"],
      ["--model", "value"],
      ["--effort", "value"],
      ["--agent", "value"],
      ["--add-dir", "value"],
      ["--project", "value"],
      ["--sandbox", "boolean"],
      ["--dangerously-skip-permissions", "boolean"],
      ["--remote-agent", "boolean"],
    ]),
  },
  resume: {
    // The form `agy` itself prints on exit, which continues the same
    // conversation in the same transcript.
    byId: (id) => `--conversation=${id}`,
    idPattern: UUID_RE,
    ref: (info) => info.sessionId,
  },
  // Measured: `agy` 1.5.19 on 2026-11-28. Idle, text plus one Enter submits, a
  // two-line paste included. While working, the same Enter queues the message:
  // it is sent as its own turn when the running one ends (`queuedMessages`
  // defaults to "queue").
  say: {
    idle: ["Enter"],
    working: { keys: ["Enter"], delivery: "queue" },
    verified: "ran agy 1.5.19, 2026-11-28",
  },
  infoSchema: AntigravityInfoSchema,
};
