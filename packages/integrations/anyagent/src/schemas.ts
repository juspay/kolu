/** Browser-safe schemas and pure types from anyagent.
 *
 *  Split out from `index.ts` so kolu-common (and the client bundle) can
 *  import zod schemas without dragging in `with-db.ts`/`wal-subscription.ts`/
 *  `tail-lines.ts`, which transitively pull `node:fs`, `node:path`, and
 *  `node:sqlite` (see juspay/kolu#682 for the same fix in the SDK packages). */

import { z } from "zod";

/** Task/todo progress — total items and completed count.
 *  Used by both Claude Code (from TaskCreate/TaskUpdate tool calls)
 *  and OpenCode (from the `todo` SQLite table). */
export const TaskProgressSchema = z.object({
  total: z.number(),
  completed: z.number(),
});

export type TaskProgress = z.infer<typeof TaskProgressSchema>;

/** Logger interface accepted by integration library functions.
 *  Structurally compatible with pino child loggers — the server
 *  creates a `log.child(...)` and passes it through. */
export type Logger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

/** Canonical list of supported agent kinds. Single source for the IR's
 *  `agentKind` enum, the renderer's friendly-label map, and the router
 *  dispatch table — adding a new vendor is one edit here plus the
 *  loader. */
export const AGENT_KINDS = ["claude-code", "opencode", "codex"] as const;
export type AgentKindLiteral = (typeof AGENT_KINDS)[number];

/** Parse an ISO-8601 timestamp string to ms-since-epoch. Returns null on
 *  empty input or unparseable strings. Shared between the Claude Code
 *  and Codex JSONL loaders (both ride ISO timestamps in their event
 *  envelopes). */
export function parseIsoTimestamp(ts: string | undefined): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

/** Unified transcript IR for the "Export agent session as HTML" feature.
 *
 *  Lives here (anyagent, the shared base) rather than kolu-common because
 *  the per-agent loaders inside `kolu-claude-code` / `kolu-opencode` /
 *  `kolu-codex` need the type, and those packages cannot import from
 *  kolu-common (kolu-common imports from them — reverse direction). The
 *  contract input/output schemas live in kolu-common where the contract
 *  itself does. */
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
   *  the storage carries one; null for vendors that don't expose ids. */
  z.object({
    kind: z.literal("tool_call"),
    id: z.string().nullable(),
    toolName: z.string(),
    inputs: z.unknown(),
    ts: z.number().nullable(),
  }),
  /** Result of a previous tool call. `output` is `unknown` so vendors can
   *  emit strings, structured payloads, or both — the renderer pretty-
   *  prints whatever it gets. */
  z.object({
    kind: z.literal("tool_result"),
    id: z.string().nullable(),
    output: z.unknown(),
    isError: z.boolean(),
    ts: z.number().nullable(),
  }),
]);

export const TranscriptSchema = z.object({
  agentKind: z.enum(AGENT_KINDS),
  /** Stable id from the source store (Claude session UUID, OpenCode
   *  `ses_…`, Codex thread UUID). Shown in the export header. */
  sessionId: z.string(),
  /** Optional human-readable title (Claude SDK summary, OpenCode title,
   *  Codex thread title). Falls back to sessionId at render time. */
  title: z.string().nullable(),
  /** Original cwd of the session (display-only). */
  cwd: z.string().nullable(),
  /** Wall-clock time the export was generated, in ms since epoch. */
  exportedAt: z.number(),
  events: z.array(TranscriptEventSchema),
});

export type TranscriptEvent = z.infer<typeof TranscriptEventSchema>;
export type Transcript = z.infer<typeof TranscriptSchema>;
