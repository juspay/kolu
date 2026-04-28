/** One-shot transcript loader for the HTML export feature.
 *
 *  Independent of `session-watcher` — that module tails the JSONL for live
 *  state derivation in 256 KB / 1 MB windows. Export is end-of-session, so
 *  it reads the whole file once and normalizes every line to the unified
 *  `TranscriptEvent` IR.
 *
 *  No vendor leakage: tool inputs/outputs are carried as `unknown`. The
 *  renderer JSON-stringifies them at display time. */

import fs from "node:fs";
import path from "node:path";
import {
  parseIsoTimestamp,
  type Transcript,
  type TranscriptEvent,
  type TranscriptPr,
} from "anyagent";
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

/** Claude Code tool names whose payload IS a file edit (as opposed to
 *  exec output, file reads, web fetches, etc.). The renderer uses this
 *  to decide whether to render the call as an inline diff (visible by
 *  default) or as a collapsed tool call (hidden under the Tools toggle).
 *  Per-vendor because each agent has its own tool registry. */
const CLAUDE_EDIT_TOOL_NAMES = new Set([
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
]);

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
          inputs: block.input,
          isEditTool: CLAUDE_EDIT_TOOL_NAMES.has(block.name),
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
      agentCalls.set(e.id, extractAgentMeta(e.inputs, e.ts));
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

export interface LoadClaudeCodeTranscriptInput {
  sessionId: string;
  cwd: string;
  title: string | null;
  repoName: string | null;
  model: string | null;
  contextTokens: number | null;
  pr: TranscriptPr | null;
}

/** Read the JSONL transcript for a Claude Code session and normalize it
 *  to the unified IR. Returns null when the transcript file doesn't
 *  exist yet (Claude creates it lazily on the first user↔assistant
 *  exchange, so a brand-new session has no JSONL). Mirrors the
 *  `Transcript | null` shape returned by the OpenCode and Codex loaders
 *  so the router's "no transcript" branch is uniform across vendors. */
export function loadClaudeCodeTranscript(
  input: LoadClaudeCodeTranscriptInput,
): Transcript | null {
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
  return {
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
}
