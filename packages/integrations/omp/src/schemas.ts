/** Effect Schema definitions for oh-my-pi session info — browser-safe.
 *
 *  Anything exported here MUST stay free of `node:*` imports and filesystem
 *  access — Effect Schema and `anyagent`'s schema re-exports only. */

import {
  type AgentVocab,
  type FlagArity,
  NODE_CLI_SHIMS,
  SESSION_PATH_OR_UUID_RE,
  TaskProgressSchema,
} from "anyagent";
import { Schema } from "effect";
import { ompSteerPane } from "./screen-scrape.ts";

export type { TaskProgress } from "anyagent";
export { TaskProgressSchema };

export const OmpInfoSchema = Schema.Struct({
  kind: Schema.Literal("omp"),
  /** Current state derived from the session transcript's tail.
   *  - `tool_use`: newest assistant message ended `stopReason: "toolUse"` —
   *    including while a tool-approval or `ask` dialog is on screen (the
   *    message completes before the tool runs).
   *  - `thinking`: newest entry is a user prompt or tool result — the model
   *    has been re-invoked or is mid-turn (omp persists an assistant message
   *    only when that message completes, so a quiet tail mid-turn reads
   *    thinking, never a stale tool_use).
   *  - `waiting`: newest assistant message ended `stop` / `length` / `error`
   *    / `aborted` — the turn ended, the agent is idle at its prompt.
   *  - `awaiting_user`: never derived from the transcript — the `screenScrape`
   *    promotion lifts a pollable state when omp paints an approval or `ask`
   *    dialog on the terminal. */
  state: Schema.Literals(["thinking", "tool_use", "awaiting_user", "waiting"]),
  /** Session UUID from the transcript filename (`<timestamp>_<uuid>.jsonl`,
   *  read off the breadcrumb's session path). */
  sessionId: Schema.String,
  /** Absolute path of the session's transcript file — the resume ref omp
   *  accepts VERBATIM (`omp --resume <path>`), and the file the state fold
   *  reads. REQUIRED: the breadcrumb hands kolu an absolute path, and
   *  `ompVocab.resume.ref` reads it directly with no `??` collapse. */
  sessionPath: Schema.String,
  /** Model identifier from the newest assistant message's `message.model`
   *  (e.g. "deepseek-v4.1-flash"), or the latest `model_change` entry's
   *  `model` when the session has no assistant turn yet. Null until either
   *  lands. */
  model: Schema.NullOr(Schema.String),
  /** Display title from the transcript's line-1 title slot — the fixed-width
   *  header omp rewrites in place, holding the title the user set or the title
   *  omp auto-generated after the first turn. Null while the slot's title is
   *  empty (a brand-new session, or `--no-title`): omp records no title then,
   *  and fabricating one from the first message would invent a name omp itself
   *  does not have. */
  summary: Schema.NullOr(Schema.String),
  /** Progress through omp's `todo` list, counted as omp's own
   *  `Overall: N/M done` line counts it (`countTodo` in `todo.ts`). Null when
   *  the conversation's live branch has no list, or omp cleared it. */
  taskProgress: Schema.NullOr(TaskProgressSchema),
  /** Running context-window token count from the newest assistant message's
   *  `usage.input + cacheRead + cacheWrite` — the same "full context the model
   *  saw" sum Claude Code derives from its three disjoint buckets (`input`
   *  here is NOT already inclusive of the cache reads, so the sum does not
   *  double-count). Null before the first assistant turn accounts. */
  contextTokens: Schema.NullOr(Schema.Number),
  /** Epoch-ms the session began — the transcript filename's timestamp (omp
   *  names the file at creation; immutable for the life of the session, so it
   *  survives a resume). Null if the filename carried no parseable timestamp.
   *  Drives the inspector's "Running for" elapsed display. */
  startedAt: Schema.NullOr(Schema.Number),
  /** The `id` of the newest `user` message entry in the transcript tail.
   *  omp writes a steer as a user entry only when the running turn TAKES it,
   *  so this changing after `agent_say`'s keys is the proof the words landed.
   *  Null before the first prompt is written. */
  lastPromptId: Schema.NullOr(Schema.String),
  /** That entry's TEXT, whitespace-collapsed and cut to
   *  `LAST_PROMPT_TEXT_CHARS` — what makes a moved `lastPromptId` THIS
   *  steer's landing rather than an older held steer's or the human's own
   *  typing. Null when the entry carried no text part, or before the first
   *  prompt. */
  lastPromptText: Schema.NullOr(Schema.String),
});

export type OmpInfo = typeof OmpInfoSchema.Type;

const OMP_MARK = {
  viewBox: "0 0 24 24",
  paint: "fill" as const,
  paths: ["M5.25 6h13.5v3H15v12h-3V9H9.75v8.25H6.75V9H5.25z"],
};

/** omp's vocabulary — display name, brand mark, CLI grammar, resume policy,
 *  and wire schema.
 *
 *  The CLI grammar is transcribed from `omp --help` (18.1.21) and omp's own
 *  `cli/flag-tables.ts` (`STRING_SETTERS` = value flags, `VALUELESS_FLAGS` =
 *  booleans), which is the single source of truth omp itself parses with. */
export const ompVocab: AgentVocab<OmpInfo> = {
  kind: "omp",
  displayName: "Oh My Pi",
  mark: OMP_MARK,
  cli: {
    basename: "omp",
    shims: NODE_CLI_SHIMS,
    stableFlags: new Map<string, FlagArity>([
      ["--model", "value"],
      ["--smol", "value"],
      ["--slow", "value"],
      ["--plan", "value"],
      ["--provider", "value"],
      ["--thinking", "value"],
      ["--approval-mode", "value"],
      ["--profile", "value"],
      ["--models", "value"],
      ["--auto-approve", "boolean"],
      ["--yolo", "boolean"],
      ["--advisor", "boolean"],
      ["--no-title", "boolean"],
      ["--hide-thinking", "boolean"],
    ]),
  },
  resume: {
    byId: (id) => `--resume ${id}`,
    idPattern: SESSION_PATH_OR_UUID_RE,
    ref: (info) => info.sessionPath,
  },
  say: {
    idle: ["Enter"],
    working: {
      keys: ["Enter"],
      delivery: "steer",
      sight: {
        lastPrompt: (info) =>
          info.lastPromptId === null
            ? null
            : { id: info.lastPromptId, text: info.lastPromptText },
        pane: ompSteerPane,
      },
    },
    verified: "ran omp 18.20.2 in a kolu terminal, 2026-11-15",
  },
  infoSchema: OmpInfoSchema,
};
