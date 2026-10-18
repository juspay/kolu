/** One-shot transcript loader for the HTML export feature.
 *
 *  Reads the OpenCode (≥ 2.0) SQLite DB end-of-session (no live tailing)
 *  and normalizes the `session_message` row sequence to the unified IR. A
 *  user row carries its prompt as `data.text`; an assistant row carries its
 *  parts inline as `data.content[]`. Tool parts carry BOTH the call input
 *  and the eventual output on the same entry — we emit them as a paired
 *  `tool_call` + `tool_result` so the renderer can collapse/expand
 *  independently of the agent.
 *
 *  Cross-session resolution: OpenCode's `subagent` tool (`task` before
 *  the 2.x rename) spawns a child session (`session_v2.parent_id` = the
 *  caller) and writes the subagent's full activity to that child. The
 *  parent's tool only carries the subagent's final reply — exporting the
 *  parent in isolation would lose every subagent's actual reasoning,
 *  tool calls, and reply. So this loader:
 *    1. Walks `parent_id` up to the root before loading, so a click on
 *       a child subagent session expands to the user's full conversation.
 *    2. For every subagent tool call it encounters, reads the child
 *       session id off its state metadata (or its output envelope) and
 *       recursively inlines that child's events between
 *       `subtask_start` / `subtask_end` boundary markers.
 *
 *  Only `user` and `assistant` rows are read; the non-conversational rows
 *  2.x also writes (such as `system` tool-rename notices, `synthetic`
 *  injected instructions, `compaction` summaries, `idle` turn-end markers)
 *  don't read as conversation content. The IR's
 *  `subtask_start`/`subtask_end` events are emitted by the loader's
 *  recursion, not pulled from the DB. */

import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "kolu-shared";
import { withDb as sharedWithDb } from "kolu-shared/sqlite";
import type {
  Fetcher,
  ToolInput,
  Transcript,
  TranscriptEvent,
} from "kolu-transcript-core";
import { opencodeVocab } from "./schemas.ts";
import { assistantModelLabel, openDb } from "./core.ts";

/** One entry of an assistant message's `data.content[]`. Only the fields
 *  we read. */
interface PartData {
  type?: string;
  text?: string;
  /** Tool-call id. */
  id?: string;
  /** Tool name. */
  name?: string;
  state?: {
    status?: string;
    input?: unknown;
    /** The tool's output, as content blocks (`{ type: "text", text }`). */
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
    /** A subagent call records its child session here — `sessionID` from
     *  the `subagent` tool, `sessionId` from the older `task` tool. */
    metadata?: { sessionID?: string; sessionId?: string } & Record<
      string,
      unknown
    >;
  };
}

/** The JSON in `session_message.data` for a user/assistant row. */
interface MessageData {
  /** A user message's prompt. */
  text?: string;
  model?: { id?: string; providerID?: string };
  time?: { created?: number; completed?: number };
  /** An assistant message's parts. */
  content?: PartData[];
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
      .prepare("SELECT parent_id FROM session_v2 WHERE id = ?")
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
    .prepare("SELECT title, directory FROM session_v2 WHERE id = ?")
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
      // 2.x renamed `read`'s argument from `filePath` to `path`.
      return { kind: "read", filePath: str("path") || str("filePath") };
    case "shell":
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

/** The tools whose call spawns a child session. */
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(["subagent", "task"]);

/** A tool part's output as text: its text content blocks joined. */
function toolOutputText(part: PartData): string {
  return (part.state?.content ?? [])
    .map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : ""))
    .join("");
}

/** Pull the child session id out of a subagent tool call. The state
 *  metadata carries it (`sessionID` / `sessionId`) — try that first since
 *  it doesn't depend on output text format; otherwise read it off the
 *  output envelope, `<subagent sessionID="ses_…">` or `<task id="ses_…">`. */
const SUBAGENT_OUTPUT_RE =
  /<(?:subagent sessionID|task id)="(ses_[A-Za-z0-9]+)"/;
function extractTaskChildSessionId(part: PartData): string | null {
  const meta = part.state?.metadata;
  const fromMeta = meta?.sessionID ?? meta?.sessionId;
  if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;
  const match = SUBAGENT_OUTPUT_RE.exec(toolOutputText(part));
  return match?.[1] ?? null;
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

/** Build transcript events from a single message's parts. Exported
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
    } else if (p.type === "tool" && typeof p.name === "string") {
      const id = p.id ?? null;
      out.push({
        kind: "tool_call",
        id,
        toolName: p.name,
        inputs: normalizeOpenCodeToolInput(p.name, p.state?.input),
        ts: messageTs,
      });
      if (p.state?.status === "completed" || p.state?.status === "error") {
        const isError = p.state.status === "error";
        out.push({
          kind: "tool_result",
          id,
          output: isError
            ? (p.state.error?.message ?? toolOutputText(p))
            : toolOutputText(p),
          isError,
          ts: messageTs,
        });
      }
      if (SUBAGENT_TOOLS.has(p.name) && inlineSubtask) {
        const childId = extractTaskChildSessionId(p);
        if (childId) {
          // We don't model subagent dispatch shapes in the IR, so the
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
    // Other part types carry no conversation content — silently skip.
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
      "SELECT type, data, time_created FROM session_message WHERE session_id = ? AND type IN ('user', 'assistant') ORDER BY seq ASC",
    )
    .all(sessionId) as Array<{
    type: "user" | "assistant";
    data: string;
    time_created: number;
  }>;
  const events: TranscriptEvent[] = [];
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
  for (const row of rows) {
    let data: MessageData;
    try {
      data = JSON.parse(row.data) as MessageData;
    } catch {
      // Drop the whole message — OpenCode writes this JSON itself, so a
      // parse failure is exotic.
      continue;
    }
    // A user row's prompt is its `text`; an assistant row's parts are its
    // `content[]`. Both go through the same part fold.
    const parts: PartData[] =
      row.type === "user"
        ? typeof data.text === "string"
          ? [{ type: "text", text: data.text }]
          : []
        : (data.content ?? []);
    events.push(
      ...eventsFromMessageParts(
        row.type,
        row.type === "assistant" ? assistantModelLabel(data) : null,
        data.time?.created ?? row.time_created ?? null,
        parts,
        inlineSubtask,
      ),
    );
  }
  return events;
}

/** Read all messages for a session and emit a unified Transcript.
 *  Walks `parent_id` to the root first so subagent-invocation child
 *  sessions expand to the user's full conversation, then recursively
 *  inlines any subagent tool's child session activity. Returns null if the
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
        agentName: opencodeVocab.displayName,
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
