/** One-shot transcript loader for the HTML export feature.
 *
 *  Reads the OpenCode SQLite DB end-of-session (no live tailing) and
 *  normalizes the flat (message, part) row sequence to the unified IR.
 *  Tool parts in OpenCode carry BOTH the call input and the eventual
 *  output on the same row — we emit them as a paired
 *  `tool_call` + `tool_result` so the renderer can collapse/expand
 *  independently of the agent.
 *
 *  Skipped part types: `step-start`, `step-finish`, `compaction`, `agent`,
 *  `subtask`. They carry lifecycle metadata that doesn't read as
 *  conversation content. */

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

/** Build transcript events from a single message's part rows. Exported
 *  for unit testing. */
export function eventsFromMessageParts(
  messageRole: "user" | "assistant",
  modelLabel: string | null,
  messageTs: number | null,
  parts: PartData[],
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
 *  Returns null if the DB is unavailable; throws if the session id is
 *  unknown.
 *
 *  Single ordered LEFT JOIN against (message, part) — replaces the
 *  N+1 (one query per message for its parts) that the first cut used.
 *  The `part_message_id_id_idx` index already supports this; the
 *  `LEFT JOIN` preserves message rows that have no parts (rare but
 *  possible for in-flight assistant turns). */
export function loadOpenCodeTranscript(
  input: LoadOpenCodeTranscriptInput,
  log?: Logger,
): Transcript | null {
  return withDb(
    (db) => {
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
        .all(input.sessionId) as Array<{
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
      const flush = () => {
        if (role !== null) {
          events.push(
            ...eventsFromMessageParts(role, modelLabel, messageTs, parts),
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
      return {
        agentKind: "opencode" as const,
        sessionId: input.sessionId,
        title: input.title,
        repoName: input.repoName,
        cwd: input.cwd,
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
