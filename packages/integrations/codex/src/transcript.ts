/** One-shot transcript loader for the HTML export feature.
 *
 *  Codex's rollout JSONL mixes lifecycle events (`event_msg:*`),
 *  per-turn context payloads (`turn_context`), and the assistant's I/O
 *  (`response_item:*`). Only a subset reads as conversation content:
 *  user messages, agent messages (visible reply), reasoning summaries,
 *  function/custom tool calls, and their matching outputs. Everything
 *  else (session_meta, turn_context, task_started/complete, token_count,
 *  exec_command_end, patch_apply_end, developer-role messages) is
 *  silently skipped — those are state-derivation signals, not
 *  conversation. */

import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import {
  type Logger,
  type Transcript,
  type TranscriptEvent,
  withDb as sharedWithDb,
} from "anyagent";
import { openDb } from "./core.ts";

interface RolloutLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    /** event_msg:user_message */
    message?: string;
    /** response_item:message (role-tagged) */
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
    /** response_item:reasoning */
    summary?: Array<{ type?: string; text?: string }>;
    /** response_item:function_call */
    name?: string;
    arguments?: string;
    call_id?: string;
    /** response_item:function_call_output */
    output?: string;
    /** response_item:custom_tool_call */
    input?: string;
    status?: string;
  };
}

function parseTimestamp(ts: string | undefined): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

/** Parse a JSON string but fall back to the raw string when invalid —
 *  Codex's tool arguments are always JSON-encoded, but we don't want a
 *  parse error to drop content silently. */
function tryParseJson(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function eventFromLine(entry: RolloutLine): TranscriptEvent | null {
  const ts = parseTimestamp(entry.timestamp);
  const outer = entry.type;
  const inner = entry.payload?.type;

  if (outer === "event_msg") {
    if (
      inner === "user_message" &&
      typeof entry.payload?.message === "string"
    ) {
      return { kind: "user", text: entry.payload.message, ts };
    }
    if (
      inner === "agent_message" &&
      typeof entry.payload?.message === "string"
    ) {
      return {
        kind: "assistant",
        text: entry.payload.message,
        model: null,
        ts,
      };
    }
    return null;
  }

  if (outer === "response_item") {
    if (inner === "reasoning") {
      const summary = entry.payload?.summary;
      if (Array.isArray(summary)) {
        const text = summary
          .map((s) => (typeof s.text === "string" ? s.text : ""))
          .filter((s) => s.length > 0)
          .join("\n");
        if (text.length > 0) return { kind: "reasoning", text, ts };
      }
      return null;
    }
    if (
      (inner === "function_call" || inner === "custom_tool_call") &&
      typeof entry.payload?.name === "string"
    ) {
      const rawInputs =
        inner === "function_call"
          ? entry.payload.arguments
          : entry.payload.input;
      return {
        kind: "tool_call",
        id: entry.payload.call_id ?? null,
        toolName: entry.payload.name,
        inputs: tryParseJson(rawInputs),
        ts,
      };
    }
    if (
      (inner === "function_call_output" ||
        inner === "custom_tool_call_output") &&
      typeof entry.payload?.call_id === "string"
    ) {
      return {
        kind: "tool_result",
        id: entry.payload.call_id,
        output: tryParseJson(entry.payload.output),
        isError: false,
        ts,
      };
    }
    // Skip developer-role messages and anything else.
    return null;
  }

  return null;
}

/** Parse a Codex rollout JSONL file's contents into transcript events.
 *  Exported for unit testing. */
export function parseCodexRollout(content: string): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    let entry: RolloutLine;
    try {
      entry = JSON.parse(line) as RolloutLine;
    } catch {
      // Malformed line — skip. Codex writes the JSONL itself; a
      // truncated final write is the only practical failure mode. One
      // corrupt entry shouldn't fail the entire export.
      continue;
    }
    const ev = eventFromLine(entry);
    if (ev) events.push(ev);
  }
  return events;
}

function withDb<T>(
  fn: (db: DatabaseSync) => T,
  errorMsg: string,
  errorCtx: Record<string, unknown>,
  log?: Logger,
): T | null {
  return sharedWithDb<DatabaseSync, T>(openDb, fn, errorMsg, errorCtx, log);
}

export interface LoadCodexTranscriptInput {
  /** Codex thread id (uuid v7). */
  sessionId: string;
  title: string | null;
  cwd: string | null;
}

/** Look up the rollout path for a thread and return null if the thread
 *  was deleted or the DB is unavailable. */
function findRolloutPath(sessionId: string, log?: Logger): string | null {
  return withDb(
    (db) => {
      const row = db
        .prepare("SELECT rollout_path FROM threads WHERE id = ?")
        .get(sessionId) as { rollout_path: string } | undefined;
      return row?.rollout_path ?? null;
    },
    "codex rollout path lookup failed",
    { sessionId },
    log,
  );
}

/** Read the rollout JSONL for a Codex session and normalize to the
 *  unified IR. Returns null if the rollout path can't be resolved or the
 *  DB is unavailable; throws if the file exists in DB but not on disk. */
export function loadCodexTranscript(
  input: LoadCodexTranscriptInput,
  log?: Logger,
): Transcript | null {
  const rolloutPath = findRolloutPath(input.sessionId, log);
  if (!rolloutPath) return null;
  const raw = fs.readFileSync(rolloutPath, "utf8");
  return {
    agentKind: "codex",
    sessionId: input.sessionId,
    title: input.title,
    cwd: input.cwd,
    exportedAt: Date.now(),
    events: parseCodexRollout(raw),
  };
}
