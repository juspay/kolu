/** Vendor-neutral transcript IR.
 *
 *  This is the contract between integration loaders (claude-code,
 *  opencode, codex) and presentation packages (transcript-html, future
 *  markdown/terminal renderers). Loaders parse their vendor's wire
 *  format INTO this shape; renderers consume it without ever looking at
 *  vendor specifics. */

import { Schema } from "effect";

/** Canonical list of supported agent kinds. Single source for the IR's
 *  `agentKind` enum, the renderer's friendly-label map, and the router
 *  dispatch table — adding a new vendor is one edit here plus the
 *  loader. */
export const AGENT_KINDS = [
  "claude-code",
  "opencode",
  "codex",
  "grok",
  "xyne",
] as const;
export type AgentKindLiteral = (typeof AGENT_KINDS)[number];

/** Tool-call inputs, decoded into a typed union at parse time.
 *
 *  Each loader is responsible for mapping its vendor's tool-name +
 *  arguments shape into one of these kinds (Claude's Edit + OpenCode's
 *  edit + Codex's apply_patch all collapse into `edit` / `write` /
 *  `patch` here). Anything not recognised falls through to `unknown`.
 *
 *  Why a typed union instead of `unknown`: the renderer was doing shape
 *  probing (`pickStr(o, "file_path", "filePath")`) — interpreting
 *  structured data without owning the structure. The probing belongs at
 *  the loader-vendor boundary, not in the renderer. With this union the
 *  renderer pattern-matches on `kind` and never touches a field that
 *  isn't part of the schema.
 *
 *  Edit-class kinds (`edit | write | patch`) replace the previous
 *  `isEditTool: boolean` IR field — kind IS the edit signal.
 *
 *  The union discriminates on `kind` (not Effect's default `_tag`), so
 *  it is a plain `Schema.Union` over structs carrying a literal `kind`
 *  — the field name and every literal value are the on-disk/on-wire
 *  contract with the loaders and the renderer. */
export const ToolInputSchema = Schema.Union([
  /** Hunk-based edit (one or more old→new replacements in one file).
   *  Claude's `Edit` carries one hunk; `MultiEdit` carries many. */
  Schema.Struct({
    kind: Schema.Literal("edit"),
    filePath: Schema.String,
    edits: Schema.Array(
      Schema.Struct({ oldText: Schema.String, newText: Schema.String }),
    ),
  }),
  /** Whole-file write (new file, or a full overwrite). Renderer treats
   *  it as a diff with an empty `oldText`. */
  Schema.Struct({
    kind: Schema.Literal("write"),
    filePath: Schema.String,
    content: Schema.String,
  }),
  /** Unified-diff patch (Codex `apply_patch`, OpenCode `apply_patch`).
   *  The renderer parses + colours the diff text. */
  Schema.Struct({
    kind: Schema.Literal("patch"),
    text: Schema.String,
  }),
  /** File read. */
  Schema.Struct({
    kind: Schema.Literal("read"),
    filePath: Schema.String,
  }),
  /** Shell command. */
  Schema.Struct({
    kind: Schema.Literal("bash"),
    command: Schema.String,
  }),
  /** Glob file search. `path` is the optional root the search is scoped
   *  to (vendors call it `path` / `cwd` / `root`). */
  Schema.Struct({
    kind: Schema.Literal("glob"),
    pattern: Schema.String,
    path: Schema.NullOr(Schema.String),
  }),
  /** Grep file-content search. */
  Schema.Struct({
    kind: Schema.Literal("grep"),
    pattern: Schema.String,
    path: Schema.NullOr(Schema.String),
  }),
  /** Web fetch — pull a specific URL. */
  Schema.Struct({
    kind: Schema.Literal("fetch"),
    url: Schema.String,
  }),
  /** Web search — distinct from `fetch` because the input is a query
   *  string, not a URL. Claude Code's `WebSearch` and equivalent
   *  vendor tools land here so the renderer can show the query
   *  prominently instead of dumping JSON. */
  Schema.Struct({
    kind: Schema.Literal("web_search"),
    query: Schema.String,
  }),
  /** Skill / slash-command invocation (Claude Code's `Skill` tool,
   *  OpenCode's `skill`, or whatever each vendor calls "invoke a
   *  packaged capability by name"). `args` is the raw argument string
   *  the agent passed; null when the skill takes no args. */
  Schema.Struct({
    kind: Schema.Literal("skill"),
    name: Schema.String,
    args: Schema.NullOr(Schema.String),
  }),
  /** Session task-list operation (Claude Code's `TaskCreate`,
   *  `TaskUpdate`, `TaskGet`, `TaskList`, `TaskOutput`, `TaskStop`,
   *  `TodoWrite`). `op` discriminates the operation; `summary` is a
   *  one-line label — the new task's subject for `create`, the task
   *  id (or new subject) for `update / get / output / stop`, the
   *  todo count for `write`, null for `list`. */
  Schema.Struct({
    kind: Schema.Literal("task"),
    op: Schema.Literals([
      "create",
      "update",
      "get",
      "list",
      "output",
      "stop",
      "delete",
      "write",
    ]),
    summary: Schema.NullOr(Schema.String),
  }),
  /** Multiple-choice user question (Claude Code's
   *  `AskUserQuestion`). The renderer shows the question prominently
   *  so the reader sees the friction point in the conversation. */
  Schema.Struct({
    kind: Schema.Literal("ask"),
    question: Schema.String,
  }),
  /** Plan-mode transitions (`EnterPlanMode`, `ExitPlanMode`). `op`
   *  discriminates; `plan` carries the proposed plan body when the
   *  agent is presenting one for approval. */
  Schema.Struct({
    kind: Schema.Literal("plan_mode"),
    op: Schema.Literals(["enter", "exit"]),
    plan: Schema.NullOr(Schema.String),
  }),
  /** Worktree session transitions (`EnterWorktree`, `ExitWorktree`).
   *  `path` is the worktree the agent is creating or entering, null
   *  when not specified or on exit. */
  Schema.Struct({
    kind: Schema.Literal("worktree"),
    op: Schema.Literals(["enter", "exit"]),
    path: Schema.NullOr(Schema.String),
  }),
  /** Scheduled-task operations (`CronCreate`, `CronDelete`,
   *  `CronList`). `summary` is the schedule + prompt for `create`,
   *  the cron id for `delete`, null for `list`. */
  Schema.Struct({
    kind: Schema.Literal("cron"),
    op: Schema.Literals(["create", "delete", "list"]),
    summary: Schema.NullOr(Schema.String),
  }),
  /** Long-running watcher (`Monitor`) — Claude runs a command in the
   *  background and reacts to each output line. `command` is the
   *  shell command being watched. */
  Schema.Struct({
    kind: Schema.Literal("monitor"),
    command: Schema.String,
  }),
  /** Code-intelligence query (`LSP`). `op` is the LSP operation
   *  (definition / references / hover / etc.); `summary` is the
   *  symbol or location it's targeting. */
  Schema.Struct({
    kind: Schema.Literal("lsp"),
    op: Schema.String,
    summary: Schema.NullOr(Schema.String),
  }),
  /** MCP resource access (`ListMcpResourcesTool`,
   *  `ReadMcpResourceTool`). `uri` is the resource URI for read,
   *  null for list. */
  Schema.Struct({
    kind: Schema.Literal("mcp_resource"),
    op: Schema.Literals(["list", "read"]),
    uri: Schema.NullOr(Schema.String),
  }),
  /** Agent-team messaging (`SendMessage`). `to` is the recipient
   *  agent id; `content` is the message body the parent agent sent. */
  Schema.Struct({
    kind: Schema.Literal("send_message"),
    to: Schema.String,
    content: Schema.String,
  }),
  /** Agent-team lifecycle (`TeamCreate`, `TeamDelete`). `summary`
   *  is the teammate list for `create`, the team id for `delete`. */
  Schema.Struct({
    kind: Schema.Literal("team"),
    op: Schema.Literals(["create", "delete"]),
    summary: Schema.NullOr(Schema.String),
  }),
  /** Deferred-tool discovery (`ToolSearch`). `query` is the search
   *  string the agent is using to load a deferred tool. */
  Schema.Struct({
    kind: Schema.Literal("tool_search"),
    query: Schema.String,
  }),
  /** Tools we haven't modelled. The renderer surfaces these honestly
   *  as "Unknown" so the reader isn't lied to — it's not a Bash or a
   *  Read or anything else we recognise. The `toolName` is repeated
   *  here so the unknown branch is self-describing (the parent
   *  `tool_call` event also carries it). */
  Schema.Struct({
    kind: Schema.Literal("unknown"),
    toolName: Schema.String,
    raw: Schema.Unknown,
  }),
]);

export type ToolInput = typeof ToolInputSchema.Type;

export const TranscriptEventSchema = Schema.Union([
  /** A user prompt. Anchor for prev/next-prompt navigation. */
  Schema.Struct({
    kind: Schema.Literal("user"),
    text: Schema.String,
    ts: Schema.NullOr(Schema.Number),
  }),
  /** Visible assistant reply text. */
  Schema.Struct({
    kind: Schema.Literal("assistant"),
    text: Schema.String,
    model: Schema.NullOr(Schema.String),
    ts: Schema.NullOr(Schema.Number),
  }),
  /** Hidden chain-of-thought / reasoning. Rendered collapsed by default. */
  Schema.Struct({
    kind: Schema.Literal("reasoning"),
    text: Schema.String,
    ts: Schema.NullOr(Schema.Number),
  }),
  /** A tool invocation. `id` correlates with a later `tool_result` when
   *  the storage carries one; null for vendors that don't expose ids.
   *  `inputs` is decoded into a typed union by each loader; the renderer
   *  dispatches on `inputs.kind`. */
  Schema.Struct({
    kind: Schema.Literal("tool_call"),
    id: Schema.NullOr(Schema.String),
    toolName: Schema.String,
    inputs: ToolInputSchema,
    ts: Schema.NullOr(Schema.Number),
  }),
  /** Result of a previous tool call. `output` stays `unknown` because
   *  vendors emit wildly varying shapes (file contents, command stdout,
   *  structured payloads, error objects); the renderer pretty-prints
   *  whatever it gets. */
  Schema.Struct({
    kind: Schema.Literal("tool_result"),
    id: Schema.NullOr(Schema.String),
    output: Schema.Unknown,
    isError: Schema.Boolean,
    ts: Schema.NullOr(Schema.Number),
  }),
  /** Begin a nested subagent run inlined into the parent transcript.
   *  Emitted by loaders that resolve cross-session references (e.g.
   *  OpenCode's `task` tool, which spawns a child session whose full
   *  activity would otherwise be invisible in the parent's export).
   *  Pairs with `subtask_end`. */
  Schema.Struct({
    kind: Schema.Literal("subtask_start"),
    description: Schema.String,
    agentName: Schema.NullOr(Schema.String),
    sessionId: Schema.NullOr(Schema.String),
    ts: Schema.NullOr(Schema.Number),
  }),
  /** Close a `subtask_start`. Loaders emit one per start; the renderer
   *  uses the pair to scope visual indentation/grouping. */
  Schema.Struct({
    kind: Schema.Literal("subtask_end"),
    ts: Schema.NullOr(Schema.Number),
  }),
]);

/** Pull request context attached to the export header. Lives on the
 *  Transcript rather than as an event so the renderer can show it
 *  prominently regardless of how many events the session has. */
export const TranscriptPrSchema = Schema.Struct({
  number: Schema.Number,
  url: Schema.String,
});
export type TranscriptPr = typeof TranscriptPrSchema.Type;

export const TranscriptSchema = Schema.Struct({
  agentKind: Schema.Literals(AGENT_KINDS),
  /** Stable id from the source store (Claude session UUID, OpenCode
   *  `ses_…`, Codex thread UUID). Shown in the export header. */
  sessionId: Schema.String,
  /** Optional human-readable title (Claude SDK summary, OpenCode title,
   *  Codex thread title). Falls back to sessionId at render time. */
  title: Schema.NullOr(Schema.String),
  /** Repo name of the cwd's git worktree (e.g. "juspay/kolu" or
   *  "kolu" when no remote is set). Null if the cwd is outside any
   *  git repo. Shown in the masthead eyebrow next to the PR link. */
  repoName: Schema.NullOr(Schema.String),
  /** Original cwd of the session (display-only). */
  cwd: Schema.NullOr(Schema.String),
  /** Model identifier from the agent metadata (e.g. "claude-opus-4-6",
   *  "gpt-5.4", "litellm/glm-latest"). Null when the session hasn't
   *  produced an assistant turn yet. */
  model: Schema.NullOr(Schema.String),
  /** Running context-window token count from the agent metadata.
   *  Pre-summed by each integration with its own accounting. Null when
   *  not yet available. */
  contextTokens: Schema.NullOr(Schema.Number),
  /** GitHub PR linked to the session's worktree, if one exists. */
  pr: Schema.NullOr(TranscriptPrSchema),
  /** Wall-clock time the export was generated, in ms since epoch. */
  exportedAt: Schema.Number,
  events: Schema.Array(TranscriptEventSchema),
});

export type TranscriptEvent = typeof TranscriptEventSchema.Type;
export type Transcript = typeof TranscriptSchema.Type;
