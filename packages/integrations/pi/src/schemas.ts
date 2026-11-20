/** Effect Schema definitions for Pi session info — browser-safe.
 *
 *  Lives in its own module so `@kolu/terminal-vocab` (and any client code)
 *  can import the schema without pulling the package root, which imports
 *  `node:fs`. Mirrors the `kolu-grok/schemas` precedent.
 *
 *  Anything exported here MUST stay free of `node:*` imports and filesystem
 *  access — Effect Schema and `anyagent`'s schema re-exports only. */

import {
  type AgentVocab,
  type FlagArity,
  NODE_CLI_SHIMS,
  SESSION_PATH_OR_UUID_RE,
  TaskProgressSchema,
  type PaneReading,
  paneHolds,
} from "anyagent";
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
   *  `--session-dir`); the path opens regardless. REQUIRED — pi's producer
   *  always has it (the file it just read), and `piVocab.resume.ref` reads it
   *  directly with no `??` collapse. */
  sessionPath: Schema.String,
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
  /** The `id` of the newest `user` message entry in the transcript tail. pi
   *  writes a steer as a user entry only when the running turn TAKES it, so
   *  this changing after `agent_say`'s keys is the proof the words landed.
   *  Null before the first prompt is written. */
  lastPromptId: Schema.NullOr(Schema.String),
  /** That entry's TEXT, whitespace-collapsed and cut to
   *  `LAST_PROMPT_TEXT_CHARS` — what makes a moved `lastPromptId` THIS
   *  steer's landing rather than an older held steer's or the human's own
   *  typing. Null when the entry carried no text part, or before the first
   *  prompt. */
  lastPromptText: Schema.NullOr(Schema.String),
});

export type PiInfo = typeof PiInfoSchema.Type;

const PI_MARK = {
  viewBox: "0 0 24 24",
  paint: "fill" as const,
  paths: ["M5 6h14v2.5H16V18h-2.5V8.5h-3V18H8V8.5H5V6z"],
};

/** pi's steering pane — one `Steering: <message>` row per held message, then
 *  `↳ Alt+Up to edit all queued messages`; captured from pi 1.5.2 in an
 *  80-column kolu terminal (2026-11-15). Read over the rows it is GIVEN — the
 *  caller cuts the screen to the rows it wants read (`agent_say`'s
 *  `SAY_STEER_SCREEN_TAIL`), where the pane sits above the input box. The
 *  FOOTER is what makes the pane readable or not: it is drawn only when pi is
 *  holding something, so a footer with no item row above it is a pane whose
 *  items this reader could not parse — never a pane without these words. */
const PI_STEERING_ITEM = /^\s*Steering: (.*)$/;
const PI_STEERING_FOOTER = /^\s*↳ Alt\+Up to edit all queued messages\s*$/;

/** What pi's steering pane says about THESE words — a steer pi accepted and is
 *  holding for the running step to end, a pane without them, or a pane this
 *  reader could not parse. */
export function piSteerPane(screenText: string, words: string): PaneReading {
  const rows = screenText.split("\n");
  const items: string[] = [];
  for (const line of rows) {
    const item = PI_STEERING_ITEM.exec(line);
    if (item !== null) items.push(item[1] ?? "");
  }
  if (items.length === 0) {
    return rows.some((line) => PI_STEERING_FOOTER.test(line))
      ? {
          kind: "unreadable",
          why: `pi's steering pane is open and kolu could read none of the ${rows.length} rows it was given`,
        }
      : { kind: "absent" };
  }
  return paneHolds(items, words);
}

/** Pi's vocabulary — display name, brand mark, CLI grammar (including its
 *  resume policy, and wire schema. */
export const piVocab: AgentVocab<PiInfo> = {
  kind: "pi",
  displayName: "Pi",
  mark: PI_MARK,
  cli: {
    basename: "pi",
    shims: NODE_CLI_SHIMS,
    stableFlags: new Map<string, FlagArity>([
      ["--model", "value"],
      ["--provider", "value"],
      ["--thinking", "value"],
      ["--name", "value"],
      ["-n", "value"],
    ]),
  },
  resume: {
    byId: (id) => `--session ${id}`,
    idPattern: SESSION_PATH_OR_UUID_RE,
    // Pi prefers the PATH over the id: pi's id lookup searches only its OWN
    // current store resolution, so a session whose store MOVED is unfindable by
    // id from a fresh invocation, while the absolute path opens unconditionally.
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
        pane: piSteerPane,
      },
    },
    verified:
      "ran pi 1.5.2 in a kolu terminal against a stand-in model, 2026-11-15",
  },
  infoSchema: PiInfoSchema,
};
