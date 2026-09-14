/** Effect Schema definitions for oh-my-pi session info — browser-safe.
 *
 *  Lives in its own module so `@kolu/terminal-vocab` (and any client code) can
 *  import the schema without pulling the package root, which imports
 *  `node:fs`. Mirrors the `kolu-pi/schemas` precedent.
 *
 *  Anything exported here MUST stay free of `node:*` imports and filesystem
 *  access — Effect Schema and `anyagent`'s schema re-exports only. */

import { type AgentVocab, type FlagArity, TaskProgressSchema } from "anyagent";
import { Schema } from "effect";

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
  /** omp's `todo` tool keeps its list in the session's tool traffic rather
   *  than a first-class count kolu reads — permanently null here; folding it
   *  is a follow-up. The field is kept for union shape uniformity. */
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
});

export type OmpInfo = typeof OmpInfoSchema.Type;

/** oh-my-pi's mark — the EXACT glyph from omp's own site favicon, scaled
 * 0.375 from its 64×64 canvas onto the contract's 24×24 one: a top bar with
 * two uneven stems hanging off it (a stylized π), source
 *  `packages/collab-web/public/favicon.svg` in oh-my-pi's repo, byte-identical
 *  to https://omp.sh/favicon.svg. The upstream branding paints this glyph in
 *  a pink→purple→cyan diagonal gradient over a dark rounded square; the
 *  `AgentMark` contract is one-ink (`currentColor`) BY DESIGN — the dock pip's
 *  color is agent STATE, not brand — so what carries here is the silhouette.
 *  The uneven stem heights (not π's equal legs) are also the detail that keeps
 *  it readable apart from `PI_MARK` at dock size. ONE mark for both the
 *  tile-chrome icon and the dock pip. */
const OMP_MARK = {
  viewBox: "0 0 24 24",
  paint: "fill" as const,
  paths: ["M5.25 6h13.5v3H15v12h-3V9H9.75v8.25H6.75V9H5.25z"],
};

/** omp's resume ref admits a session id or an absolute session PATH, restricted
 *  to shell-inert writing-system characters (no control, no quotes, no
 *  `$`/`;`/backtick/metachars). The splice itself always goes through
 *  `shellJoin`, which is the lock; this is the second wall. */
const OMP_RESUME_REF_RE =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\/[\w .,@=+(){}#%/~-]*\.jsonl)$/;

/** omp's vocabulary — display name, brand mark, CLI grammar (including its
 *  one-shot/subcommand carve-outs), resume policy, and wire schema.
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
    // omp's one-shot surface: `-v` is its version spell (there is no `-V`),
    // and `--export` / `-p` (`--print`) / `--alias` print a result and exit.
    extraExitFlags: new Set(["-v", "--export", "-p", "--print", "--alias"]),
    // `--no-session` is ephemeral, so no session file appears and no breadcrumb
    // is written — there is nothing to bind to. `--session-dir <dir>` is
    // deliberately NOT here: it moves the session FILE, but omp still writes
    // the breadcrumb, which carries the absolute path — kolu binds that session
    // exactly as it binds a default-store one.
    nonSessionFlags: new Set(["--no-session"]),
    // BARE positional subcommand words — only in argv position 0: omp
    // dispatches a subcommand from its FIRST argument alone, and any later
    // occurrence is prompt text for an interactive session.
    //
    // `cleanse`, `commit`, and `join` are deliberately ABSENT: each drives a
    // real omp session in the current terminal (`cleanse` via
    // `SessionManager.create`, `commit` via the SDK's `createAgentSession`,
    // `join` by launching the TUI), so each writes a breadcrumb kolu binds —
    // listing them as non-session would deny a session that exists.
    nonSessionSubcommands: new Set([
      "acp",
      "agents",
      "auth-broker",
      "auth-gateway",
      "bench",
      "browser-relay",
      "collab",
      "completions",
      "compress",
      "config",
      "dry-balance",
      "gallery",
      "gc",
      "git",
      "grep",
      "grievances",
      "if-bench",
      "images",
      "install",
      "models",
      "plugin",
      "ps",
      "read",
      "render",
      "say",
      "search",
      "setup",
      "share",
      "shell",
      "ssh",
      "stats",
      "tiny-models",
      "token",
      "ttsr",
      "update",
      "usage",
      "worktree",
      "wt", // `omp worktree`'s alias
    ]),
  },
  resume: {
    last: "-c",
    byId: (id) => `--resume ${id}`,
    idPattern: OMP_RESUME_REF_RE,
    // omp prefers the PATH over the id: `--resume <ref>` accepts an id prefix, a
    // filename prefix, OR an absolute path, and only the path survives a store
    // that moved (a `--session-dir` run, a profile switch) — the breadcrumb
    // hands kolu that path, so it is always available.
    ref: (info) => info.sessionPath,
  },
  infoSchema: OmpInfoSchema,
};
