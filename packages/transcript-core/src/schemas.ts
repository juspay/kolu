/** Vendor-neutral transcript IR.
 *
 *  This is the contract between integration loaders (claude-code,
 *  opencode, codex) and presentation packages (transcript-html, future
 *  markdown/terminal renderers). Loaders parse their vendor's wire
 *  format INTO this shape; renderers consume it without ever looking at
 *  vendor specifics. */

import { z } from "zod";

/** Canonical list of supported agent kinds. Single source for the IR's
 *  `agentKind` enum, the renderer's friendly-label map, and the router
 *  dispatch table — adding a new vendor is one edit here plus the
 *  loader. */
export const AGENT_KINDS = ["claude-code", "opencode", "codex"] as const;
export type AgentKindLiteral = (typeof AGENT_KINDS)[number];

/** Tool-call inputs, decoded into a typed union at parse time.
 *
 *  Each loader is responsible for mapping its vendor's tool-name +
 *  arguments shape into one of these kinds (Claude's Edit + OpenCode's
 *  edit + Codex's apply_patch all collapse into `edit` / `write` /
 *  `patch` here). Anything not recognised falls through to `opaque`.
 *
 *  Why a typed union instead of `unknown`: the renderer was doing shape
 *  probing (`pickStr(o, "file_path", "filePath")`) — interpreting
 *  structured data without owning the structure. The probing belongs at
 *  the loader-vendor boundary, not in the renderer. With this union the
 *  renderer pattern-matches on `kind` and never touches a field that
 *  isn't part of the schema.
 *
 *  Edit-class kinds (`edit | write | patch`) replace the previous
 *  `isEditTool: boolean` IR field — kind IS the edit signal. */
export const ToolInputSchema = z.discriminatedUnion("kind", [
  /** Hunk-based edit (one or more old→new replacements in one file).
   *  Claude's `Edit` carries one hunk; `MultiEdit` carries many. */
  z.object({
    kind: z.literal("edit"),
    filePath: z.string(),
    edits: z.array(z.object({ oldText: z.string(), newText: z.string() })),
  }),
  /** Whole-file write (new file, or a full overwrite). Renderer treats
   *  it as a diff with an empty `oldText`. */
  z.object({
    kind: z.literal("write"),
    filePath: z.string(),
    content: z.string(),
  }),
  /** Unified-diff patch (Codex `apply_patch`, OpenCode `apply_patch`).
   *  The renderer parses + colours the diff text. */
  z.object({
    kind: z.literal("patch"),
    text: z.string(),
  }),
  /** File read. */
  z.object({
    kind: z.literal("read"),
    filePath: z.string(),
  }),
  /** Shell command. */
  z.object({
    kind: z.literal("bash"),
    command: z.string(),
  }),
  /** Glob file search. `path` is the optional root the search is scoped
   *  to (vendors call it `path` / `cwd` / `root`). */
  z.object({
    kind: z.literal("glob"),
    pattern: z.string(),
    path: z.string().nullable(),
  }),
  /** Grep file-content search. */
  z.object({
    kind: z.literal("grep"),
    pattern: z.string(),
    path: z.string().nullable(),
  }),
  /** Web fetch. */
  z.object({
    kind: z.literal("fetch"),
    url: z.string(),
  }),
  /** Anything else — vendor-specific tools, new tools we haven't yet
   *  modelled. Renderer pretty-prints the raw payload as JSON. The
   *  `toolName` is repeated here so the opaque branch is self-describing
   *  (the parent tool_call event also carries it). */
  z.object({
    kind: z.literal("opaque"),
    toolName: z.string(),
    raw: z.unknown(),
  }),
]);

export type ToolInput = z.infer<typeof ToolInputSchema>;

export const TranscriptEventSchema = z.discriminatedUnion("kind", [
  /** A user prompt. Anchor for prev/next-prompt navigation. */
  z.object({
    kind: z.literal("user"),
    text: z.string(),
    ts: z.number().nullable(),
  }),
  /** Visible assistant reply text. */
  z.object({
    kind: z.literal("assistant"),
    text: z.string(),
    model: z.string().nullable(),
    ts: z.number().nullable(),
  }),
  /** Hidden chain-of-thought / reasoning. Rendered collapsed by default. */
  z.object({
    kind: z.literal("reasoning"),
    text: z.string(),
    ts: z.number().nullable(),
  }),
  /** A tool invocation. `id` correlates with a later `tool_result` when
   *  the storage carries one; null for vendors that don't expose ids.
   *  `inputs` is decoded into a typed union by each loader; the renderer
   *  dispatches on `inputs.kind`. */
  z.object({
    kind: z.literal("tool_call"),
    id: z.string().nullable(),
    toolName: z.string(),
    inputs: ToolInputSchema,
    ts: z.number().nullable(),
  }),
  /** Result of a previous tool call. `output` stays `unknown` because
   *  vendors emit wildly varying shapes (file contents, command stdout,
   *  structured payloads, error objects); the renderer pretty-prints
   *  whatever it gets. */
  z.object({
    kind: z.literal("tool_result"),
    id: z.string().nullable(),
    output: z.unknown(),
    isError: z.boolean(),
    ts: z.number().nullable(),
  }),
  /** Begin a nested subagent run inlined into the parent transcript.
   *  Emitted by loaders that resolve cross-session references (e.g.
   *  OpenCode's `task` tool, which spawns a child session whose full
   *  activity would otherwise be invisible in the parent's export).
   *  Pairs with `subtask_end`. */
  z.object({
    kind: z.literal("subtask_start"),
    description: z.string(),
    agentName: z.string().nullable(),
    sessionId: z.string().nullable(),
    ts: z.number().nullable(),
  }),
  /** Close a `subtask_start`. Loaders emit one per start; the renderer
   *  uses the pair to scope visual indentation/grouping. */
  z.object({
    kind: z.literal("subtask_end"),
    ts: z.number().nullable(),
  }),
]);

/** Pull request context attached to the export header. Lives on the
 *  Transcript rather than as an event so the renderer can show it
 *  prominently regardless of how many events the session has. */
export const TranscriptPrSchema = z.object({
  number: z.number(),
  url: z.string(),
});
export type TranscriptPr = z.infer<typeof TranscriptPrSchema>;

export const TranscriptSchema = z.object({
  agentKind: z.enum(AGENT_KINDS),
  /** Stable id from the source store (Claude session UUID, OpenCode
   *  `ses_…`, Codex thread UUID). Shown in the export header. */
  sessionId: z.string(),
  /** Optional human-readable title (Claude SDK summary, OpenCode title,
   *  Codex thread title). Falls back to sessionId at render time. */
  title: z.string().nullable(),
  /** Repo name of the cwd's git worktree (e.g. "juspay/kolu" or
   *  "kolu" when no remote is set). Null if the cwd is outside any
   *  git repo. Shown in the masthead eyebrow next to the PR link. */
  repoName: z.string().nullable(),
  /** Original cwd of the session (display-only). */
  cwd: z.string().nullable(),
  /** Model identifier from the agent metadata (e.g. "claude-opus-4-6",
   *  "gpt-5.4", "litellm/glm-latest"). Null when the session hasn't
   *  produced an assistant turn yet. */
  model: z.string().nullable(),
  /** Running context-window token count from the agent metadata.
   *  Pre-summed by each integration with its own accounting. Null when
   *  not yet available. */
  contextTokens: z.number().nullable(),
  /** GitHub PR linked to the session's worktree, if one exists. */
  pr: TranscriptPrSchema.nullable(),
  /** Wall-clock time the export was generated, in ms since epoch. */
  exportedAt: z.number(),
  events: z.array(TranscriptEventSchema),
});

export type TranscriptEvent = z.infer<typeof TranscriptEventSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
