/** One-shot transcript loader for the HTML export feature.
 *
 *  Grok Build's conversation lives in `chat_history.jsonl` under the
 *  per-session dir — a flat JSONL of `system` / `user` / `assistant` /
 *  `reasoning` / `tool_result` rows (no SQLite). Only conversation-
 *  relevant rows become IR events; the opening system prompt is dropped
 *  (vendor boilerplate, same choice Claude's loader makes for its
 *  system lines). */

import fs from "node:fs";
import type {
  Fetcher,
  ToolInput,
  Transcript,
  TranscriptEvent,
} from "kolu-transcript-core";
import { chatHistoryPathFor } from "./core.ts";

interface GrokHistoryLine {
  type?: string;
  content?: unknown;
  /** Synthetic system/user rows (compaction meta, etc.) — skipped. */
  synthetic_reason?: string;
  model_id?: string;
  tool_calls?: Array<{
    id?: string;
    name?: string;
    arguments?: string | Record<string, unknown>;
  }>;
  tool_call_id?: string;
  summary?: Array<{ type?: string; text?: string }>;
  /** Present on some rows; Grok chat_history often omits timestamps. */
  ts?: string;
  timestamp?: string;
}

/** Pull plain text out of Grok's multi-shape `content` field:
 *  a bare string, or `[{type:"text", text:"…"}, …]`. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n");
}

/**
 * Case-insensitive `indexOf` for a fixed needle. Avoids regex so the
 * harness unwrap cannot trip CodeQL `js/polynomial-redos` (the previous
 * `/<tag>[\s\S]*?<\/tag>/` form flagged high on PR #1738).
 */
function indexOfCi(haystack: string, needle: string, from = 0): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase(), from);
}

/** Drop every `<tag>…</tag>` block (case-insensitive, fixed tag name).
 *  Unclosed open tags drop from the open marker to end of string. */
function stripBlockTag(s: string, tag: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let out = "";
  let searchFrom = 0;
  while (true) {
    const openIdx = indexOfCi(s, open, searchFrom);
    if (openIdx < 0) {
      out += s.slice(searchFrom);
      break;
    }
    out += s.slice(searchFrom, openIdx);
    const afterOpen = openIdx + open.length;
    const closeIdx = indexOfCi(s, close, afterOpen);
    if (closeIdx < 0) break; // unclosed — drop remainder
    searchFrom = closeIdx + close.length;
  }
  return out;
}

/** Extract every closed `<user_query>…</user_query>` body (index scan). */
function extractUserQueries(raw: string): string[] {
  const open = "<user_query>";
  const close = "</user_query>";
  const queries: string[] = [];
  let searchFrom = 0;
  while (true) {
    const openIdx = indexOfCi(raw, open, searchFrom);
    if (openIdx < 0) break;
    const afterOpen = openIdx + open.length;
    const closeIdx = indexOfCi(raw, close, afterOpen);
    if (closeIdx < 0) break;
    const inner = raw.slice(afterOpen, closeIdx).trim();
    if (inner.length > 0) queries.push(inner);
    searchFrom = closeIdx + close.length;
  }
  return queries;
}

/**
 * Grok stores the human prompt inside harness tags on disk, e.g.
 *   `<user_query>\nhi\n</user_query>`
 * often next to other non-prompt blocks (`<image_files>…`, compression
 * notices). The export must show what the human typed — not the wire
 * envelope. Prefer the joined inner text of every `<user_query>` block;
 * if none are present, strip known harness wrappers and leftover tags.
 *
 * Implemented with index scans only — no `[\s\S]*?` regex on library
 * input (CodeQL `js/polynomial-redos`).
 */
export function unwrapGrokUserText(raw: string): string {
  const queries = extractUserQueries(raw);
  if (queries.length > 0) return queries.join("\n\n");

  // No well-formed user_query — drop known non-prompt harness blocks and
  // any leftover open/close tags so a partial write never paints raw XML.
  let out = raw;
  for (const tag of [
    "image_files",
    "image_compression_notice",
    "user_info",
    "git_status",
  ]) {
    out = stripBlockTag(out, tag);
  }
  for (const marker of ["</user_query>", "<user_query>"]) {
    let rebuilt = "";
    let from = 0;
    while (true) {
      const i = indexOfCi(out, marker, from);
      if (i < 0) {
        rebuilt += out.slice(from);
        break;
      }
      rebuilt += out.slice(from, i);
      from = i + marker.length;
    }
    out = rebuilt;
  }
  return out.trim();
}

/** Map Grok tool basenames + JSON args onto the typed `ToolInput` union.
 *  Grok's names are snake_case (`run_terminal_command`, `read_file`, …)
 *  rather than Claude's PascalCase — same IR kinds. */
export function normalizeGrokToolInput(
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
    case "run_terminal_command":
      return { kind: "bash", command: str("command") };
    case "read_file":
      return { kind: "read", filePath: str("target_file") || str("path") };
    case "search_replace":
      return {
        kind: "edit",
        filePath: str("file_path") || str("path"),
        edits: [
          {
            oldText: str("old_string") || str("old_str"),
            newText: str("new_string") || str("new_str"),
          },
        ],
      };
    case "write":
      return {
        kind: "write",
        filePath: str("file_path") || str("path"),
        content: str("content") || str("contents"),
      };
    case "grep":
      return {
        kind: "grep",
        pattern: str("pattern"),
        path: typeof o.path === "string" ? (o.path as string) : null,
      };
    case "list_dir":
      return {
        kind: "glob",
        pattern: "*",
        path: str("target_directory") || str("path") || null,
      };
    case "web_search":
      return { kind: "web_search", query: str("query") };
    case "web_fetch":
    case "open_page":
    case "web_fetch_page":
      return { kind: "fetch", url: str("url") };
    case "todo_write":
    case "update_goal": {
      const todos = Array.isArray(o.todos) ? o.todos.length : 0;
      return {
        kind: "task",
        op: "write",
        summary: todos > 0 ? `${todos} todos` : str("message") || null,
      };
    }
    case "ask_user_question":
      return {
        kind: "ask",
        question:
          str("question") || str("prompt") || contentToText(o.questions),
      };
    case "enter_plan_mode":
      return { kind: "plan_mode", op: "enter", plan: null };
    case "exit_plan_mode":
      return { kind: "plan_mode", op: "exit", plan: null };
    default:
      return { kind: "unknown", toolName, raw };
  }
}

function tryParseJson(
  raw: string | Record<string, unknown> | undefined,
): unknown {
  if (raw === undefined) return undefined;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parseTs(entry: GrokHistoryLine): number | null {
  const iso = entry.ts ?? entry.timestamp;
  if (typeof iso !== "string") return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Convert one chat_history line into zero or more transcript events. */
export function eventsFromGrokLine(entry: GrokHistoryLine): TranscriptEvent[] {
  const ts = parseTs(entry);
  const type = entry.type;

  // Skip synthetic bookkeeping rows (compaction meta, etc.).
  if (entry.synthetic_reason) return [];

  if (type === "system") return []; // system prompt — not conversation

  if (type === "user") {
    const text = unwrapGrokUserText(contentToText(entry.content));
    if (!text) return [];
    return [{ kind: "user", text, ts }];
  }

  if (type === "reasoning") {
    const summary = entry.summary;
    if (!Array.isArray(summary)) return [];
    const text = summary
      .map((s) => (typeof s?.text === "string" ? s.text : ""))
      .filter((s) => s.length > 0)
      .join("\n")
      .trim();
    if (!text) return [];
    return [{ kind: "reasoning", text, ts }];
  }

  if (type === "assistant") {
    const out: TranscriptEvent[] = [];
    const text = contentToText(entry.content).trim();
    if (text) {
      out.push({
        kind: "assistant",
        text,
        model: typeof entry.model_id === "string" ? entry.model_id : null,
        ts,
      });
    }
    if (Array.isArray(entry.tool_calls)) {
      for (const call of entry.tool_calls) {
        if (!call || typeof call.name !== "string") continue;
        out.push({
          kind: "tool_call",
          id: typeof call.id === "string" ? call.id : null,
          toolName: call.name,
          inputs: normalizeGrokToolInput(
            call.name,
            tryParseJson(call.arguments),
          ),
          ts,
        });
      }
    }
    return out;
  }

  if (type === "tool_result") {
    return [
      {
        kind: "tool_result",
        id: typeof entry.tool_call_id === "string" ? entry.tool_call_id : null,
        output: entry.content ?? null,
        isError: false,
        ts,
      },
    ];
  }

  return [];
}

/** Parse a Grok `chat_history.jsonl` body into transcript events.
 *  Exported for unit testing. */
export function parseGrokChatHistory(content: string): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    let entry: GrokHistoryLine;
    try {
      entry = JSON.parse(line) as GrokHistoryLine;
    } catch {
      // Truncated final write — drop the line, keep the export.
      continue;
    }
    for (const ev of eventsFromGrokLine(entry)) events.push(ev);
  }
  return events;
}

/** Read `chat_history.jsonl` for a Grok session and normalize it to the
 *  unified IR. Returns null when the file is absent (session just created
 *  or never flushed) — same `Transcript | null` contract as the Claude /
 *  Codex / OpenCode loaders. */
export const loadGrokTranscript: Fetcher = (input) => {
  if (!input.cwd) return null;
  const file = chatHistoryPathFor(input.cwd, input.sessionId);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const transcript: Transcript = {
    agentKind: "grok",
    sessionId: input.sessionId,
    title: input.title,
    repoName: input.repoName,
    cwd: input.cwd,
    model: input.model,
    contextTokens: input.contextTokens,
    pr: input.pr,
    exportedAt: Date.now(),
    events: parseGrokChatHistory(raw),
  };
  return transcript;
};
