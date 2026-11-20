import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "kolu-shared";
import { withDb as sharedWithDb } from "kolu-shared/sqlite";
import type {
  Fetcher,
  ToolInput,
  Transcript,
  TranscriptEvent,
} from "kolu-transcript-core";
import {
  assistantModelLabel,
  type ContentPart,
  type MessageData,
  openDb,
} from "./core.ts";
import { opencodeVocab } from "./schemas.ts";

function walkToRoot(db: DatabaseSync, sessionId: string): string {
  const seen = new Set<string>();
  let current = sessionId;
  while (!seen.has(current)) {
    seen.add(current);
    const row = db
      .prepare("SELECT parent_id FROM session_v2 WHERE id = ?")
      .get(current) as { parent_id: string | null } | undefined;
    if (!row?.parent_id) return current;
    current = row.parent_id;
  }
  return current;
}

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
 *  vs Claude's snake_case. */
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
      // and accept either casing OpenCode might land on.
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
      // OpenCode's question carries `{ questions: Prompt[] }`; each Prompt
      // has a text field.
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

function toolOutputText(part: ContentPart): string {
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
function extractTaskChildSessionId(part: ContentPart): string | null {
  const meta = part.state?.metadata;
  const fromMeta = meta?.sessionID ?? meta?.sessionId;
  if (typeof fromMeta === "string" && fromMeta.length > 0) return fromMeta;
  const match = SUBAGENT_OUTPUT_RE.exec(toolOutputText(part));
  return match?.[1] ?? null;
}

/** When inlining a subagent's child session into the parent transcript,
 *  drop the leading `user` event: OpenCode writes the parent's dispatch
 *  prompt as `role: "user"` because from the subagent's POV its caller is
 *  the user. */
export function stripDispatchPrompt(
  childEvents: TranscriptEvent[],
): TranscriptEvent[] {
  return childEvents[0]?.kind === "user" ? childEvents.slice(1) : childEvents;
}

/** Build transcript events from a single message's parts. `inlineSubtask`
 *  resolves subagent-tool calls into the child session's nested events. */
export function eventsFromMessageParts(
  messageRole: "user" | "assistant",
  modelLabel: string | null,
  messageTs: number | null,
  parts: ContentPart[],
  inlineSubtask: (
    childSessionId: string,
    description: string,
    ts: number | null,
  ) => TranscriptEvent[],
): TranscriptEvent[] {
  const out: TranscriptEvent[] = [];
  for (const p of parts) {
    if (p.type === "text" && typeof p.text === "string") {
      // OpenCode streams text in deltas and sometimes leaves empty text
      // parts behind, which render as empty assistant cards.
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
      if (SUBAGENT_TOOLS.has(p.name)) {
        const childId = extractTaskChildSessionId(p);
        if (childId) {
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
      continue;
    }
    const parts: ContentPart[] =
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

/** Read all messages for a session and emit a unified Transcript. Walks
 *  `parent_id` to the root first so subagent-invocation child sessions
 *  expand to the user's full conversation, then recursively inlines any
 *  subagent tool's child session activity. Returns null if the DB is
 *  unavailable; throws if the session id is unknown. */
export const loadOpenCodeTranscript: Fetcher = (input, log) => {
  return withDb(
    (db) => {
      const rootId = walkToRoot(db, input.sessionId);
      const visited = new Set<string>();
      const events = loadSessionEvents(db, rootId, visited);
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
