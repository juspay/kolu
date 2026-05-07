/** One-shot transcript loader for the HTML export feature.
 *
 *  Independent of `session-watcher` — that module tails the JSONL for live
 *  state derivation in 256 KB / 1 MB windows. Export is end-of-session, so
 *  it reads the whole file once and normalizes every line to the unified
 *  `TranscriptEvent` IR.
 *
 *  Tool inputs are decoded into the typed `ToolInput` union at parse
 *  time (claude's `Edit` → `{kind:"edit"}`, `Bash` → `{kind:"bash"}`,
 *  etc.). Anything not modelled becomes `{kind:"unknown"}` and the
 *  renderer surfaces it honestly as "Unknown" instead of pretending
 *  it's a recognised tool. Tool outputs stay `unknown` (the type) —
 *  vendors emit too many shapes to model usefully. */

import fs from "node:fs";
import path from "node:path";
import {
  type Fetcher,
  parseIsoTimestamp,
  type ToolInput,
  type Transcript,
  type TranscriptEvent,
} from "kolu-transcript-core";
import { encodeProjectPath, PROJECTS_DIR } from "./core.ts";

interface AssistantContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  id?: string;
  /** tool_result blocks on user lines. */
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface JsonlEntry {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string | null;
    content?: AssistantContentBlock[] | string;
  };
  toolUseResult?: unknown;
}

/** Convert one JSONL line into zero or more transcript events. Assistant
 *  lines fan out into one event per content block (text, thinking,
 *  tool_use); user lines become a single event whose shape depends on
 *  the content block kind. */
function eventsFromEntry(entry: JsonlEntry): TranscriptEvent[] {
  const ts = parseIsoTimestamp(entry.timestamp);

  if (entry.type === "user") {
    const content = entry.message?.content;
    if (typeof content === "string") {
      return [{ kind: "user", text: content, ts }];
    }
    if (!Array.isArray(content)) return [];
    const out: TranscriptEvent[] = [];
    for (const block of content) {
      if (block.type === "tool_result") {
        out.push({
          kind: "tool_result",
          id: block.tool_use_id ?? null,
          output: block.content,
          isError: block.is_error === true,
          ts,
        });
      } else if (block.type === "text" && typeof block.text === "string") {
        out.push({ kind: "user", text: block.text, ts });
      }
    }
    return out;
  }

  if (entry.type === "assistant") {
    const content = entry.message?.content;
    if (!Array.isArray(content)) return [];
    const model = entry.message?.model ?? null;
    const out: TranscriptEvent[] = [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        out.push({ kind: "assistant", text: block.text, model, ts });
      } else if (
        block.type === "thinking" &&
        typeof block.thinking === "string" &&
        block.thinking.length > 0
      ) {
        // Anthropic's extended-thinking blocks are often returned with
        // an empty `thinking` field and only a populated `signature`
        // (the model's reasoning is server-side and not exposed to the
        // client). Suppress those rather than render an empty card.
        out.push({ kind: "reasoning", text: block.thinking, ts });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        out.push({
          kind: "tool_call",
          id: block.id ?? null,
          toolName: block.name,
          inputs: normalizeClaudeToolInput(block.name, block.input),
          ts,
        });
      }
    }
    return out;
  }

  return [];
}

/** Parse a Claude Code JSONL transcript. Exported for unit testing. */
export function parseClaudeCodeJsonl(content: string): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    let entry: JsonlEntry;
    try {
      entry = JSON.parse(line) as JsonlEntry;
    } catch {
      // Malformed line — skip. Claude writes the JSONL itself, so this is
      // rare in practice; ignoring lets a single corrupt entry not bring
      // down the entire export.
      continue;
    }
    events.push(...eventsFromEntry(entry));
  }
  return inlineAgentSubtasks(events);
}

/** Map a Claude Code tool name + raw input object onto the typed
 *  `ToolInput` union. Anything we don't recognise becomes `unknown`,
 *  carrying the raw payload through unchanged. Exported for testing. */
export function normalizeClaudeToolInput(
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
    case "Edit":
      return {
        kind: "edit",
        filePath: str("file_path"),
        edits: [{ oldText: str("old_string"), newText: str("new_string") }],
      };
    case "MultiEdit": {
      const edits = Array.isArray(o.edits) ? (o.edits as unknown[]) : [];
      return {
        kind: "edit",
        filePath: str("file_path"),
        edits: edits.map((e) => {
          const eo = (typeof e === "object" && e !== null ? e : {}) as Record<
            string,
            unknown
          >;
          return {
            oldText: typeof eo.old_string === "string" ? eo.old_string : "",
            newText: typeof eo.new_string === "string" ? eo.new_string : "",
          };
        }),
      };
    }
    case "Write":
      return {
        kind: "write",
        filePath: str("file_path"),
        content: str("content"),
      };
    case "NotebookEdit":
      return {
        kind: "edit",
        filePath: str("notebook_path"),
        edits: [{ oldText: str("old_source"), newText: str("new_source") }],
      };
    case "Read":
      return { kind: "read", filePath: str("file_path") };
    case "Bash":
      return { kind: "bash", command: str("command") };
    case "Glob":
      return {
        kind: "glob",
        pattern: str("pattern"),
        path: typeof o.path === "string" ? (o.path as string) : null,
      };
    case "Grep":
      return {
        kind: "grep",
        pattern: str("pattern"),
        path: typeof o.path === "string" ? (o.path as string) : null,
      };
    case "WebFetch":
      return { kind: "fetch", url: str("url") };
    case "WebSearch":
      return { kind: "web_search", query: str("query") };
    case "PowerShell":
      // PowerShell shares Bash's shape (`{ command }`). Surfacing it as
      // `kind: "bash"` lets the renderer show the command line directly
      // — the dock's hide-tools toggle, the role label, and the
      // command-summary all just work.
      return { kind: "bash", command: str("command") };
    case "Skill": {
      // Claude Code's Skill tool carries `{ skill: "name", args: "…" }`.
      // Some skill invocations have no args (the slash-command form).
      const argsField = typeof o.args === "string" ? (o.args as string) : null;
      return {
        kind: "skill",
        name: str("skill"),
        args: argsField && argsField.length > 0 ? argsField : null,
      };
    }
    case "TaskCreate":
      return { kind: "task", op: "create", summary: str("subject") || null };
    case "TaskUpdate":
      return {
        kind: "task",
        op: "update",
        summary: str("subject") || str("taskId") || null,
      };
    case "TaskGet":
      return { kind: "task", op: "get", summary: str("taskId") || null };
    case "TaskList":
      return { kind: "task", op: "list", summary: null };
    case "TaskOutput":
      return { kind: "task", op: "output", summary: str("taskId") || null };
    case "TaskStop":
      return { kind: "task", op: "stop", summary: str("taskId") || null };
    case "TodoWrite": {
      const todos = Array.isArray(o.todos) ? o.todos.length : 0;
      return {
        kind: "task",
        op: "write",
        summary: todos > 0 ? `${todos} todos` : null,
      };
    }
    case "AskUserQuestion":
      return { kind: "ask", question: str("question") };
    case "EnterPlanMode":
      return { kind: "plan_mode", op: "enter", plan: str("plan") || null };
    case "ExitPlanMode":
      return { kind: "plan_mode", op: "exit", plan: str("plan") || null };
    case "EnterWorktree":
      return { kind: "worktree", op: "enter", path: str("path") || null };
    case "ExitWorktree":
      return { kind: "worktree", op: "exit", path: null };
    case "CronCreate": {
      // Cron payload carries `{ when, prompt }`; the prompt is the
      // most useful summary line.
      const summary = str("prompt") || str("when") || null;
      return { kind: "cron", op: "create", summary };
    }
    case "CronDelete":
      return { kind: "cron", op: "delete", summary: str("id") || null };
    case "CronList":
      return { kind: "cron", op: "list", summary: null };
    case "Monitor":
      return { kind: "monitor", command: str("command") };
    case "LSP":
      return {
        kind: "lsp",
        op: str("operation") || str("op") || "query",
        summary: str("symbol") || str("query") || null,
      };
    case "ListMcpResourcesTool":
      return { kind: "mcp_resource", op: "list", uri: null };
    case "ReadMcpResourceTool":
      return { kind: "mcp_resource", op: "read", uri: str("uri") || null };
    case "SendMessage":
      return {
        kind: "send_message",
        to: str("to") || str("agentId"),
        content: str("content") || str("message"),
      };
    case "TeamCreate": {
      const teammates = Array.isArray(o.teammates) ? o.teammates.length : 0;
      return {
        kind: "team",
        op: "create",
        summary: teammates > 0 ? `${teammates} teammates` : null,
      };
    }
    case "TeamDelete":
      return { kind: "team", op: "delete", summary: str("teamId") || null };
    case "ToolSearch":
      return { kind: "tool_search", query: str("query") };
    default:
      return { kind: "unknown", toolName, raw };
  }
}

interface AgentCallMeta {
  description: string;
  agentName: string | null;
  ts: number | null;
}

/** Claude Code's `Agent` tool dispatches a sub-agent that runs in an
 *  ephemeral process. Unlike OpenCode (where the child session's full
 *  activity is persisted and we recurse into it), Claude only writes
 *  the dispatch (`tool_use` input) and the final reply text
 *  (`tool_result` content) into the JSONL — the subagent's reasoning
 *  and tool calls are not kept. Replacing the tool_call/tool_result
 *  pair with a `subtask_start` / assistant / `subtask_end` triple makes
 *  subagent dispatches visible by default (rather than hidden behind
 *  the Tools toggle as a generic tool call), at the cost of dropping
 *  the full prompt text — only the short description survives, which
 *  is consistent with how OpenCode subtask boundaries label
 *  in-flight/incomplete dispatches. */
function inlineAgentSubtasks(events: TranscriptEvent[]): TranscriptEvent[] {
  const agentCalls = new Map<string, AgentCallMeta>();
  for (const e of events) {
    if (e.kind === "tool_call" && e.toolName === "Agent" && e.id) {
      // Agent inputs go through normalizeClaudeToolInput as `unknown`;
      // pull description / subagent_type back out of the raw payload.
      const raw = e.inputs.kind === "unknown" ? e.inputs.raw : null;
      agentCalls.set(e.id, extractAgentMeta(raw, e.ts));
    }
  }
  if (agentCalls.size === 0) return events;
  const out: TranscriptEvent[] = [];
  for (const e of events) {
    if (e.kind === "tool_call" && e.toolName === "Agent" && e.id) {
      // Suppress — replaced by the subtask block emitted around the
      // matching tool_result below.
      continue;
    }
    if (e.kind === "tool_result" && e.id && agentCalls.has(e.id)) {
      const meta = agentCalls.get(e.id);
      if (!meta) continue;
      const replyText = extractAgentReplyText(e.output);
      out.push({
        kind: "subtask_start",
        description: meta.description,
        agentName: meta.agentName,
        sessionId: null,
        ts: meta.ts,
      });
      if (replyText.length > 0) {
        out.push({
          kind: "assistant",
          text: replyText,
          model: null,
          ts: e.ts,
        });
      }
      out.push({ kind: "subtask_end", ts: e.ts });
      continue;
    }
    out.push(e);
  }
  return out;
}

function extractAgentMeta(inputs: unknown, ts: number | null): AgentCallMeta {
  if (typeof inputs !== "object" || inputs === null) {
    return { description: "Subagent", agentName: null, ts };
  }
  const obj = inputs as Record<string, unknown>;
  const description =
    typeof obj.description === "string" && obj.description.length > 0
      ? obj.description
      : "Subagent";
  const agentName =
    typeof obj.subagent_type === "string" ? obj.subagent_type : null;
  return { description, agentName, ts };
}

/** Pull the reply text out of an Agent tool_result. Claude serializes
 *  it as either a plain string or `[{type: "text", text}, ...]`. */
function extractAgentReplyText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const parts: string[] = [];
    for (const block of output) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        parts.push((block as { text: string }).text);
      }
    }
    return parts.join("\n");
  }
  return "";
}

/** Read the JSONL transcript for a Claude Code session and normalize it
 *  to the unified IR. Returns null when:
 *    - cwd is missing (Claude encodes the projects-dir path from cwd, so
 *      we can't locate the JSONL without one)
 *    - the transcript file doesn't exist yet (Claude creates it lazily
 *      on the first user↔assistant exchange, so a brand-new session has
 *      no JSONL)
 *  Mirrors the `Transcript | null` shape returned by the OpenCode and
 *  Codex loaders so the router's "no transcript" branch is uniform
 *  across vendors. */
export const loadClaudeCodeTranscript: Fetcher = (input) => {
  if (!input.cwd) return null;
  const file = path.join(
    PROJECTS_DIR,
    encodeProjectPath(input.cwd),
    `${input.sessionId}.jsonl`,
  );
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const transcript: Transcript = {
    agentKind: "claude-code",
    sessionId: input.sessionId,
    title: input.title,
    repoName: input.repoName,
    cwd: input.cwd,
    model: input.model,
    contextTokens: input.contextTokens,
    pr: input.pr,
    exportedAt: Date.now(),
    events: parseClaudeCodeJsonl(raw),
  };
  return transcript;
};
