/** One-shot transcript loader for the HTML export feature.
 *
 *  Reads the OpenCode SQLite DB end-of-session (no live tailing) and
 *  normalizes the flat (message, part) row sequence to the unified IR.
 *  Tool parts in OpenCode carry BOTH the call input and the eventual
 *  output on the same row — we emit them as a paired
 *  `tool_call` + `tool_result` so the renderer can collapse/expand
 *  independently of the agent.
 *
 *  Cross-session resolution: OpenCode's `task` tool spawns a child
 *  session (via `sessions.create({ parentID, ... })`) and writes the
 *  subagent's full activity to that child. The parent's task tool only
 *  carries a one-line summary in `<task_result>` tags — exporting the
 *  parent in isolation would lose every subagent's actual reasoning,
 *  tool calls, and reply. So this loader:
 *    1. Walks `parent_id` up to the root before loading, so a click on
 *       a child subagent session expands to the user's full conversation.
 *    2. For every `task` tool call it encounters, parses the child
 *       session id out of the output (`task_id: ses_xxx ...`) and
 *       recursively inlines that child's events between
 *       `subtask_start` / `subtask_end` boundary markers.
 *
 *  Skipped part types: `step-start`, `step-finish`, `compaction`, `agent`,
 *  `subtask`. They carry lifecycle metadata that doesn't read as
 *  conversation content. The on-parent `subtask` part type is distinct
 *  from our IR's `subtask_start`/`subtask_end` events — those are
 *  emitted by the loader's recursion, not pulled from the DB. */

import type { DatabaseSync } from "node:sqlite";
import {
  type Logger,
  type Transcript,
  type TranscriptEvent,
  type TranscriptPr,
  withDb as sharedWithDb,
} from "anyagent";
import { openDb } from "./core.ts";

interface PartData {
  type?: string;
  text?: string;
  callID?: string;
  tool?: string;
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    metadata?: { sessionId?: string } & Record<string, unknown>;
  };
  filename?: string;
  url?: string;
  mime?: string;
}

interface MessageMeta {
  role?: "user" | "assistant";
  modelID?: string;
  providerID?: string;
  time?: { created?: number; completed?: number };
}

/** Defensive cap on the parent-id walk. OpenCode shouldn't produce
 *  cycles (each child is created with `parentID = current`), but a
 *  bounded walk + visited-set keeps a corrupt row from looping
 *  forever. 64 hops is well past any realistic subagent nesting. */
const MAX_PARENT_HOPS = 64;

/** Walk `parent_id` to the root. Returns the input id unchanged when no
 *  parent exists. Cycle-safe via a visited set. */
function walkToRoot(db: DatabaseSync, sessionId: string): string {
  const seen = new Set<string>();
  let current = sessionId;
  for (let hop = 0; hop < MAX_PARENT_HOPS; hop++) {
    if (seen.has(current)) return current;
    seen.add(current);
    const row = db
      .prepare("SELECT parent_id FROM session WHERE id = ?")
      .get(current) as { parent_id: string | null } | undefined;
    if (!row?.parent_id) return current;
    current = row.parent_id;
  }
  return current;
}

/** Look up display metadata for a session row. */
function fetchSessionDisplay(
  db: DatabaseSync,
  sessionId: string,
): { title: string | null; directory: string | null } {
  const row = db
    .prepare("SELECT title, directory FROM session WHERE id = ?")
    .get(sessionId) as
    | { title: string | null; directory: string | null }
    | undefined;
  return {
    title: row?.title ?? null,
    directory: row?.directory ?? null,
  };
}

/** Pull the child session id out of a task-tool's output. The task tool
 *  prefixes its output with `task_id: ses_xxx (for resuming...)` (see
 *  upstream `packages/opencode/src/tool/task.ts`). The state metadata
 *  also carries `sessionId` when the tool wrote its `ctx.metadata({...})`
 *  envelope — try that first since it doesn't depend on output text
 *  format. */
const TASK_ID_OUTPUT_RE = /^task_id:\s*(ses_[A-Za-z0-9]+)/m;
function extractTaskChildSessionId(part: PartData): string | null {
  const fromMeta = part.state?.metadata?.sessionId;
  if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;
  const out = part.state?.output;
  if (typeof out === "string") {
    const match = TASK_ID_OUTPUT_RE.exec(out);
    if (match) return match[1] ?? null;
  }
  return null;
}

/** Build transcript events from a single message's part rows. Exported
 *  for unit testing. The `inlineSubtask` callback lets the caller
 *  resolve task-tool calls into nested events; passing `undefined`
 *  preserves the legacy non-recursive behavior the unit tests rely on. */
export function eventsFromMessageParts(
  messageRole: "user" | "assistant",
  modelLabel: string | null,
  messageTs: number | null,
  parts: PartData[],
  inlineSubtask?: (
    childSessionId: string,
    description: string,
    ts: number | null,
  ) => TranscriptEvent[],
): TranscriptEvent[] {
  const out: TranscriptEvent[] = [];
  for (const p of parts) {
    if (p.type === "text" && typeof p.text === "string") {
      if (messageRole === "user") {
        out.push({ kind: "user", text: p.text, ts: messageTs });
      } else {
        out.push({
          kind: "assistant",
          text: p.text,
          model: modelLabel,
          ts: messageTs,
        });
      }
    } else if (p.type === "reasoning" && typeof p.text === "string") {
      out.push({ kind: "reasoning", text: p.text, ts: messageTs });
    } else if (p.type === "tool" && typeof p.tool === "string") {
      const id = p.callID ?? null;
      out.push({
        kind: "tool_call",
        id,
        toolName: p.tool,
        inputs: p.state?.input,
        ts: messageTs,
      });
      if (p.state?.status === "completed" || p.state?.status === "error") {
        out.push({
          kind: "tool_result",
          id,
          output: p.state.output,
          isError: p.state.status === "error",
          ts: messageTs,
        });
      }
      if (p.tool === "task" && inlineSubtask) {
        const childId = extractTaskChildSessionId(p);
        if (childId) {
          const description =
            (typeof p.state?.input === "object" &&
            p.state.input !== null &&
            "description" in p.state.input &&
            typeof (p.state.input as { description: unknown }).description ===
              "string"
              ? ((p.state.input as { description: string }).description ?? "")
              : "") || "Subtask";
          out.push(...inlineSubtask(childId, description, messageTs));
        }
      }
    }
    // Other part types (file, step-start, step-finish, patch, compaction,
    // subtask, agent) carry no conversation content — silently skip.
  }
  return out;
}

function withDb<T>(
  fn: (db: DatabaseSync) => T,
  errorMsg: string,
  errorCtx: Record<string, unknown>,
  log?: Logger,
): T | null {
  return sharedWithDb<DatabaseSync, T>(openDb, fn, errorMsg, errorCtx, log);
}

/** Load the events for a single session, recursing into child sessions
 *  spawned via the `task` tool. `visited` guards against cycles in the
 *  unlikely event a child references a session already on the stack. */
function loadSessionEvents(
  db: DatabaseSync,
  sessionId: string,
  visited: Set<string>,
): TranscriptEvent[] {
  if (visited.has(sessionId)) return [];
  visited.add(sessionId);
  const rows = db
    .prepare(
      `SELECT m.id AS message_id,
              m.data AS message_data,
              m.time_created AS message_time,
              p.data AS part_data
         FROM message m
         LEFT JOIN part p ON p.message_id = m.id
        WHERE m.session_id = ?
        ORDER BY m.time_created ASC, p.time_created ASC`,
    )
    .all(sessionId) as Array<{
    message_id: string;
    message_data: string;
    message_time: number;
    part_data: string | null;
  }>;
  const events: TranscriptEvent[] = [];
  let lastMessageId: string | null = null;
  let role: "user" | "assistant" | null = null;
  let modelLabel: string | null = null;
  let messageTs: number | null = null;
  let parts: PartData[] = [];
  const inlineSubtask = (
    childSessionId: string,
    description: string,
    ts: number | null,
  ): TranscriptEvent[] => {
    const childDisplay = fetchSessionDisplay(db, childSessionId);
    const agentName = childDisplay.title?.match(/@(\w+) subagent/)?.[1] ?? null;
    const childEvents = loadSessionEvents(db, childSessionId, visited);
    return [
      {
        kind: "subtask_start",
        description,
        agentName,
        sessionId: childSessionId,
        ts,
      },
      ...childEvents,
      { kind: "subtask_end", ts },
    ];
  };
  const flush = () => {
    if (role !== null) {
      events.push(
        ...eventsFromMessageParts(
          role,
          modelLabel,
          messageTs,
          parts,
          inlineSubtask,
        ),
      );
    }
  };
  for (const row of rows) {
    if (row.message_id !== lastMessageId) {
      flush();
      lastMessageId = row.message_id;
      parts = [];
      let meta: MessageMeta;
      try {
        meta = JSON.parse(row.message_data) as MessageMeta;
      } catch {
        // Drop the whole message — without role we can't classify any
        // of its parts. OpenCode writes this JSON itself, so a parse
        // failure is exotic.
        role = null;
        continue;
      }
      if (meta.role !== "user" && meta.role !== "assistant") {
        role = null;
        continue;
      }
      role = meta.role;
      modelLabel = meta.modelID
        ? meta.providerID
          ? `${meta.providerID}/${meta.modelID}`
          : meta.modelID
        : null;
      messageTs = meta.time?.created ?? row.message_time ?? null;
    }
    if (role === null || row.part_data === null) continue;
    try {
      parts.push(JSON.parse(row.part_data) as PartData);
    } catch {
      // Malformed part — skip; OpenCode owns the writer so this is rare.
    }
  }
  flush();
  return events;
}

export interface LoadOpenCodeTranscriptInput {
  sessionId: string;
  title: string | null;
  repoName: string | null;
  cwd: string | null;
  model: string | null;
  contextTokens: number | null;
  pr: TranscriptPr | null;
}

/** Read all messages + parts for a session and emit a unified Transcript.
 *  Walks `parent_id` to the root first so subagent-invocation child
 *  sessions expand to the user's full conversation, then recursively
 *  inlines any `task` tool's child session activity. Returns null if the
 *  DB is unavailable; throws if the session id is unknown. */
export function loadOpenCodeTranscript(
  input: LoadOpenCodeTranscriptInput,
  log?: Logger,
): Transcript | null {
  return withDb(
    (db) => {
      const rootId = walkToRoot(db, input.sessionId);
      const visited = new Set<string>();
      const events = loadSessionEvents(db, rootId, visited);
      // If we walked up, the root carries the conversation's true title
      // and cwd. Prefer those over the kolu-runtime metadata that
      // described the (possibly child) session the user clicked on.
      const rootDisplay =
        rootId === input.sessionId ? null : fetchSessionDisplay(db, rootId);
      return {
        agentKind: "opencode" as const,
        sessionId: rootId,
        title: rootDisplay?.title ?? input.title,
        repoName: input.repoName,
        cwd: rootDisplay?.directory ?? input.cwd,
        model: input.model,
        contextTokens: input.contextTokens,
        pr: input.pr,
        exportedAt: Date.now(),
        events,
      };
    },
    "opencode transcript load failed",
    { sessionId: input.sessionId },
    log,
  );
}
