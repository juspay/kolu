/** One-shot transcript loader for the HTML export feature.
 *
 *  Xyne's conversation lives in the per-cwd session file
 *  `~/.xyne/agent/sessions/<encoded-cwd>/<timestamp>_<session-id>.jsonl`
 *  — a flat JSONL of pi-format rows. Only conversation-relevant rows
 *  become IR events; the envelope rows (`session` header, `model_change`,
 *  `thinking_level_change`, `custom`, `session_info`, `compaction`,
 *  `custom_message`) are transport metadata, dropped the way the grok
 *  loader drops its system rows.
 *
 *  Xyne's assistant message carries token usage on the row itself
 *  (`message.usage`), so the FetcherInput.contextTokens hint is
 *  secondary — if the row is present it's fresher than the hint passed
 *  in. The loader reads it but the IR's `contextTokens` comes from
 *  deriveXyneInfo for the badge; the loader doesn't re-publish it.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  Fetcher,
  ToolInput,
  Transcript,
  TranscriptEvent,
} from "kolu-transcript-core";
import { SESSIONS_DIR } from "./config.ts";
import { encodeCwd } from "./core.ts";

interface XyneUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens: number;
}

interface XyneContentBlock {
  type: string;
  /** type=text */
  text?: string;
  /** type=thinking */
  thinking?: string;
  /** type=toolCall */
  id?: string;
  name?: string;
  arguments?: Record<string, unknown> | string;
  /** type=image (dropped — not a text event) */
}

interface XyneLine {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  message?: {
    role: "user" | "assistant" | "toolResult";
    content?: XyneContentBlock[];
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    model?: string;
    usage?: XyneUsage;
    stopReason?: "stop" | "toolUse" | "error";
    timestamp?: number;
  };
}

/** Pull plain text out of Xyne's multi-block `content` field:
 *  a text block, a thinking block, or a toolCall. */
export function contentToText(blocks: XyneContentBlock[] | undefined): {
  text: string;
  thinking: string;
} {
  const out = { text: "", thinking: "" };
  if (!Array.isArray(blocks)) return out;
  for (const b of blocks) {
    if (b.type === "text" && typeof b.text === "string") out.text += b.text;
    if (b.type === "thinking" && typeof b.thinking === "string")
      out.thinking += b.thinking;
  }
  return out;
}

/** Map Xyne's tool name + args onto the typed `ToolInput` union. Xyne's
 *  tool naming inherits pi's convention (`bash`, `ls`, `read`, `edit`, …)
 *  — lowercase snake names with the argument shape matching Claude's
 *  PascalCase tool after a camel→snake key normalization. */
export function normalizeXyneToolInput(
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
    case "bash":
    case "run_terminal_command":
      return { kind: "bash", command: str("command") };
    case "read":
    case "read_file":
      return { kind: "read", filePath: str("path") || str("target_file") };
    case "edit":
    case "search_replace": {
      const filePath = str("path") || str("file_path");
      const oldText = str("oldText") || str("old_string") || str("old_str");
      const newText = str("newText") || str("new_string") || str("new_str");
      return oldText || newText
        ? { kind: "edit", filePath, edits: [{ oldText, newText }] }
        : { kind: "read", filePath };
    }
    case "write":
      return {
        kind: "write",
        filePath: str("path") || str("file_path"),
        content: str("content") || str("contents"),
      };
    case "ls":
    case "list_dir":
      return {
        kind: "glob",
        pattern: "*",
        path: str("path") || str("target_directory") || null,
      };
    case "find":
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
    case "web_search":
      return { kind: "web_search", query: str("query") };
    case "web_fetch":
    case "fetch":
      return { kind: "fetch", url: str("url") };
    case "skill":
      return {
        kind: "skill",
        name: str("name") || str("skill"),
        args: typeof o.args === "string" ? (o.args as string) : null,
      };
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

function parseTs(entry: XyneLine): number | null {
  const iso = entry.timestamp;
  if (typeof iso !== "string") return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Convert one pi JSONL line into zero or more transcript events.
 *  Exported for unit testing. */
export function eventsFromXyneLine(entry: XyneLine): TranscriptEvent[] {
  const ts = parseTs(entry);
  // Everything except `{"type":"message", ...}` is session bookkeeping.
  if (entry.type !== "message") return [];
  const msg = entry.message;
  if (!msg) return [];

  if (msg.role === "user") {
    const { text } = contentToText(msg.content);
    if (!text.trim()) return [];
    return [{ kind: "user", text, ts }];
  }

  if (msg.role === "assistant") {
    const out: TranscriptEvent[] = [];
    const { text, thinking } = contentToText(msg.content);
    if (thinking.trim()) {
      out.push({ kind: "reasoning", text: thinking, ts });
    }
    if (text.trim()) {
      out.push({
        kind: "assistant",
        text,
        model: typeof msg.model === "string" ? msg.model : null,
        ts,
      });
    }
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type !== "toolCall") continue;
        if (typeof block.name !== "string") continue;
        out.push({
          kind: "tool_call",
          id: typeof block.id === "string" ? block.id : null,
          toolName: block.name,
          inputs: normalizeXyneToolInput(
            block.name,
            tryParseJson(block.arguments),
          ),
          ts,
        });
      }
    }
    return out;
  }

  if (msg.role === "toolResult") {
    const { text } = contentToText(msg.content);
    return [
      {
        kind: "tool_result",
        id: typeof msg.toolCallId === "string" ? msg.toolCallId : null,
        output: text || null,
        isError: msg.isError === true,
        ts,
      },
    ];
  }

  return [];
}

/** Parse a Xyne session JSONL body into transcript events.
 *  Exported for unit testing. */
export function parseXyneSessionJsonl(content: string): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    let entry: XyneLine;
    try {
      entry = JSON.parse(line) as XyneLine;
    } catch {
      // Truncated final write — drop the line, keep the export.
      continue;
    }
    for (const ev of eventsFromXyneLine(entry)) events.push(ev);
  }
  return events;
}

/** Read the session JSONL for a Xyne session and normalize to the unified
 *  IR. Returns null when the file is absent (brand-new session or the
 *  per-cwd dir hasn't been flushed yet) — same `Transcript | null`
 *  contract as the other loaders.
 *
 *  Token usage: Xyne stamps `message.usage` onto every assistant row, so
 *  the most recent row's usage is fresher than any seed the sensor
 *  passed in. The Fetcher contract doesn't model usage on the output
 *  side; the renderer reads `contextTokens` from the AgentInfo (which the
 *  sensor already derived from the same file). This loader doesn't
 *  re-publish a stale snapshot.
 */
/** Pull the freshest `usage.totalTokens` off the tail of the parsed lines.
 *  Xyne stamps every assistant row; the badge's own deriveXyneInfo reads the
 *  same value from the same file — one source of truth for "how full is the
 *  window right now". */
function latestTotalTokens(content: string): number | null {
  for (const line of content.split("\n").reverse()) {
    if (!line) continue;
    let entry: XyneLine;
    try {
      entry = JSON.parse(line) as XyneLine;
    } catch {
      continue;
    }
    if (entry.type !== "message" || entry.message?.role !== "assistant")
      continue;
    const usage = entry.message.usage;
    if (usage && typeof usage.totalTokens === "number") {
      return usage.totalTokens;
    }
    // Missing usage on the newest assistant row is the "no telemetry yet"
    // case — don't walk further back inventing an older snapshot as
    // "current".
    return null;
  }
  return null;
}

export const loadXyneTranscript: Fetcher = (input) => {
  if (!input.cwd) return null;
  const dir = path.join(SESSIONS_DIR, encodeCwd(input.cwd));
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  // Match by sessionId, not by recency — `resolveXyneSession` owns the
  // newest-file rule; the export must read the exact session the AgentInfo
  // was built from, regardless of what else has been written since.
  const name = names.find((n) => n.includes(`_${input.sessionId}.jsonl`));
  if (!name) return null;
  const transcriptPath = path.join(dir, name);
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const transcript: Transcript = {
    agentKind: "xyne",
    sessionId: input.sessionId,
    title: input.title,
    repoName: input.repoName,
    cwd: input.cwd,
    model: input.model,
    // Token usage: Xyne stamps `message.usage` on every assistant row, so the
    // freshest row's totalTokens is authoritative. The hint passed in is a
    // fallback for a session whose newest row carries no telemetry (a
    // compaction boundary, a corrupt line — cases the sensor itself reads
    // as "no current total").
    contextTokens: latestTotalTokens(raw) ?? input.contextTokens,
    pr: input.pr,
    exportedAt: Date.now(),
    events: parseXyneSessionJsonl(raw),
  };
  return transcript;
};
