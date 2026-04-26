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
  cwd: string | null;
}

/** Read all messages + parts for a session and emit a unified Transcript.
 *  Returns null if the DB is unavailable; throws if the session id is
 *  unknown. */
export function loadOpenCodeTranscript(
  input: LoadOpenCodeTranscriptInput,
  log?: Logger,
): Transcript | null {
  return withDb(
    (db) => {
      const messages = db
        .prepare(
          "SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created ASC",
        )
        .all(input.sessionId) as Array<{
        id: string;
        data: string;
        time_created: number;
      }>;
      const partStmt = db.prepare(
        "SELECT data, time_created FROM part WHERE message_id = ? ORDER BY time_created ASC",
      );
      const events: TranscriptEvent[] = [];
      for (const row of messages) {
        let meta: MessageMeta;
        try {
          meta = JSON.parse(row.data) as MessageMeta;
        } catch {
          continue;
        }
        const role = meta.role;
        if (role !== "user" && role !== "assistant") continue;
        const modelLabel = meta.modelID
          ? meta.providerID
            ? `${meta.providerID}/${meta.modelID}`
            : meta.modelID
          : null;
        const ts = meta.time?.created ?? row.time_created ?? null;
        const partRows = partStmt.all(row.id) as Array<{
          data: string;
          time_created: number;
        }>;
        const parts: PartData[] = [];
        for (const pr of partRows) {
          try {
            parts.push(JSON.parse(pr.data) as PartData);
          } catch {
            // Malformed part — skip; OpenCode owns the writer so this is rare.
          }
        }
        events.push(...eventsFromMessageParts(role, modelLabel, ts, parts));
      }
      return {
        agentKind: "opencode" as const,
        sessionId: input.sessionId,
        title: input.title,
        cwd: input.cwd,
        exportedAt: Date.now(),
        events,
      };
    },
    "opencode transcript load failed",
    { sessionId: input.sessionId },
    log,
  );
}
