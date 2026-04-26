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
  return events;
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
