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
import type { Logger } from "kolu-shared";
import { withDb as sharedWithDb } from "kolu-shared/sqlite";
import type {
  Fetcher,
  ToolInput,
  Transcript,
  TranscriptEvent,
} from "kolu-transcript-core";
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

/** Map an OpenCode tool name + raw input object onto the typed
 *  `ToolInput` union. OpenCode uses camelCase (`filePath`, `oldString`)
 *  vs Claude's snake_case — that's the entire reason this normalizer
 *  exists per-vendor. Exported for testing. */
export function normalizeOpenCodeToolInput(
  toolName: string,
  raw: unknown,
): ToolInput {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  const str = (k: string): string =>
    typeof o[k] === "string" ? (o[k] as string) : "";

  switch (toolName) {
    case "edit":
      return {
        kind: "edit",
        filePath: str("filePath"),
        edits: [{ oldText: str("oldString"), newText: str("newString") }],
      };
    case "write":
      return {
        kind: "write",
        filePath: str("filePath"),
        content: str("content"),
      };
    case "apply_patch":
      // OpenCode's apply_patch carries either the patch text or a
      // structured `{patch}` payload, depending on the tool variant.
      if (typeof raw === "string") return { kind: "patch", text: raw };
      if (typeof o.patch === "string") {
        return { kind: "patch", text: o.patch };
      }
      return { kind: "unknown", toolName, raw };
    case "read":
      return { kind: "read", filePath: str("filePath") };
    case "bash":
      return { kind: "bash", command: str("command") };
    case "glob":
      return {
        kind: "glob",
        pattern: str("pattern"),
        path: typeof o.path === "string" ? (o.path as string) : null,
      };
    case "grep":
      return {
        kind: "grep",
        pattern: str("pattern"),
        path: typeof o.path === "string" ? (o.path as string) : null,
      };
    case "webfetch":
    case "fetch":
      return { kind: "fetch", url: str("url") };
    case "websearch":
    case "web_search":
      return { kind: "web_search", query: str("query") };
    case "skill":
    case "Skill": {
      // Mirror Claude Code's Skill payload shape (`{ skill, args }`)
      // and accept either casing OpenCode might land on. If a future
      // OpenCode release uses a different field, we'll learn about it
      // when this branch starts producing empty names.
      const argsField = typeof o.args === "string" ? (o.args as string) : null;
      return {
        kind: "skill",
        name: str("skill") || str("name"),
        args: argsField && argsField.length > 0 ? argsField : null,
      };
    }
    case "todowrite": {
      // OpenCode's todowrite carries `{ todos: TodoItem[] }`.
      const todos = Array.isArray(o.todos) ? o.todos.length : 0;
      return {
        kind: "task",
        op: "write",
        summary: todos > 0 ? `${todos} todos` : null,
      };
    }
    case "question": {
      // OpenCode's question carries `{ questions: Prompt[] }`. Each
      // Prompt has a text field; we surface the first question's text
      // so the renderer's "Ask · …" summary actually shows what was
      // asked rather than dumping JSON.
      const questions = Array.isArray(o.questions) ? o.questions : [];
      const first = questions[0] as Record<string, unknown> | undefined;
      const text =
        typeof first?.text === "string"
          ? (first.text as string)
          : typeof first?.question === "string"
            ? (first.question as string)
            : "";
      return { kind: "ask", question: text };
    }
    case "lsp":
      return {
        kind: "lsp",
        op: str("operation") || "query",
        summary: str("filePath") || null,
      };
    default:
      return { kind: "unknown", toolName, raw };
  }
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

/** When inlining a subagent's child session into the parent transcript,
 *  drop the leading `user` event. That event is the parent agent's
 *  dispatch prompt — OpenCode writes it as `role: "user"` because from
 *  the subagent's POV its caller is the user. Without stripping it, the
 *  export visually attributes the dispatch text to the human, which is
 *  wrong. The dispatch is already represented by the `subtask_start`
 *  divider (agent name + short description) and the `task` tool call's
 *  input (full prompt, visible when the Tools toggle is on). Subsequent
 *  user events in the child session — if any — would come from later
 *  task_id resumption dispatches and stay as-is. Exported for testing. */
export function stripDispatchPrompt(
  childEvents: TranscriptEvent[],
): TranscriptEvent[] {
  return childEvents[0]?.kind === "user" ? childEvents.slice(1) : childEvents;
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
      // OpenCode streams text in deltas and sometimes leaves empty text
      // parts behind (a part row created when a streaming delta starts
      // but never receives content, or a turn that ends mid-stream).
      // They render as empty assistant cards if we pass them through.
      if (p.text.trim().length === 0) continue;
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
      if (p.text.trim().length === 0) continue;
      out.push({ kind: "reasoning", text: p.text, ts: messageTs });
    } else if (p.type === "tool" && typeof p.tool === "string") {
      const id = p.callID ?? null;
      out.push({
        kind: "tool_call",
        id,
        toolName: p.tool,
        inputs: normalizeOpenCodeToolInput(p.tool, p.state?.input),
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
          // We don't model `task` dispatch shapes in the IR, so the
          // description comes from the raw input here.
          const rawInput = p.state?.input;
          const description =
            (typeof rawInput === "object" &&
            rawInput !== null &&
            "description" in rawInput &&
            typeof (rawInput as { description: unknown }).description ===
              "string"
              ? ((rawInput as { description: string }).description ?? "")
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
    const trimmed = stripDispatchPrompt(childEvents);
    return [
      {
        kind: "subtask_start",
        description,
        agentName,
        sessionId: childSessionId,
        ts,
      },
      ...trimmed,
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

/** Read all messages + parts for a session and emit a unified Transcript.
 *  Walks `parent_id` to the root first so subagent-invocation child
 *  sessions expand to the user's full conversation, then recursively
 *  inlines any `task` tool's child session activity. Returns null if the
 *  DB is unavailable; throws if the session id is unknown. */
export const loadOpenCodeTranscript: Fetcher = (input, log) => {
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
      const transcript: Transcript = {
        agentKind: "opencode",
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
      return transcript;
    },
    "opencode transcript load failed",
    { sessionId: input.sessionId },
    log,
  );
};
