import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { Logger } from "kolu-shared";
import { withDb as sharedWithDb } from "kolu-shared/sqlite";
import {
  type Fetcher,
  parseIsoTimestamp,
  type ToolInput,
  type Transcript,
  type TranscriptEvent,
} from "kolu-transcript-core";
import { codexVocab } from "./schemas.ts";
import { openDb } from "./core.ts";

interface RolloutLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    message?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
    summary?: Array<{ type?: string; text?: string }>;
    name?: string;
    arguments?: string;
    call_id?: string;
    output?: string;
    input?: string;
    status?: string;
  };
}

function tryParseJson(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function eventFromLine(entry: RolloutLine): TranscriptEvent | null {
  const ts = parseIsoTimestamp(entry.timestamp);
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
        inputs: normalizeCodexToolInput(
          entry.payload.name,
          tryParseJson(rawInputs),
        ),
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
    return null;
  }

  return null;
}

export function parseCodexRollout(content: string): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  for (const line of content.split("\n")) {
    if (line.length === 0) continue;
    let entry: RolloutLine;
    try {
      entry = JSON.parse(line) as RolloutLine;
    } catch {
      continue;
    }
    const ev = eventFromLine(entry);
    if (ev) events.push(ev);
  }
  return events;
}

export function codexEnvelopeToUnifiedDiff(text: string): string {
  if (!/^\s*\*\*\* Begin Patch\b/.test(text)) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  const isMarker = (l: string | undefined): boolean =>
    l?.startsWith("*** ") ?? false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line === "*** Begin Patch" || line === "*** End Patch") {
      i++;
      continue;
    }
    const add = /^\*\*\* Add File: (.+)$/.exec(line);
    if (add) {
      const filePath = (add[1] ?? "").trim();
      i++;
      const newLines: string[] = [];
      while (i < lines.length && !isMarker(lines[i])) {
        const l = lines[i] ?? "";
        if (l.startsWith("+")) newLines.push(l.slice(1));
        i++;
      }
      out.push(`diff --git a/${filePath} b/${filePath}`);
      out.push("new file mode 100644");
      out.push("--- /dev/null");
      out.push(`+++ b/${filePath}`);
      out.push(`@@ -0,0 +1,${newLines.length} @@`);
      for (const nl of newLines) out.push(`+${nl}`);
      continue;
    }
    const del = /^\*\*\* Delete File: (.+)$/.exec(line);
    if (del) {
      const filePath = (del[1] ?? "").trim();
      i++;
      const oldLines: string[] = [];
      while (i < lines.length && !isMarker(lines[i])) {
        const l = lines[i] ?? "";
        if (l.startsWith("-")) oldLines.push(l.slice(1));
        i++;
      }
      out.push(`diff --git a/${filePath} b/${filePath}`);
      out.push("deleted file mode 100644");
      out.push(`--- a/${filePath}`);
      out.push("+++ /dev/null");
      out.push(`@@ -1,${oldLines.length} +0,0 @@`);
      for (const ol of oldLines) out.push(`-${ol}`);
      continue;
    }
    const upd = /^\*\*\* Update File: (.+)$/.exec(line);
    if (upd) {
      const sourcePath = (upd[1] ?? "").trim();
      i++;
      let filePath = sourcePath;
      if (i < lines.length) {
        const move = /^\*\*\* Move to: (.+)$/.exec(lines[i] ?? "");
        if (move) {
          filePath = (move[1] ?? "").trim();
          i++;
        }
      }
      out.push(`diff --git a/${filePath} b/${filePath}`);
      out.push(`--- a/${filePath}`);
      out.push(`+++ b/${filePath}`);
      let hunk: string[] = [];
      const flushHunk = () => {
        if (hunk.length === 0) return;
        let oldCount = 0;
        let newCount = 0;
        for (const l of hunk) {
          if (l.startsWith("+")) newCount++;
          else if (l.startsWith("-")) oldCount++;
          else {
            oldCount++;
            newCount++;
          }
        }
        out.push(`@@ -1,${oldCount} +1,${newCount} @@`);
        for (const l of hunk) out.push(l);
        hunk = [];
      };
      while (i < lines.length && !isMarker(lines[i])) {
        const l = lines[i] ?? "";
        if (l.startsWith("@@")) {
          flushHunk();
        } else if (
          l.startsWith("+") ||
          l.startsWith("-") ||
          l.startsWith(" ")
        ) {
          hunk.push(l);
        } else {
          hunk.push(` ${l}`);
        }
        i++;
      }
      flushHunk();
      continue;
    }
    i++;
  }
  return out.join("\n");
}

export function normalizeCodexToolInput(
  toolName: string,
  parsed: unknown,
): ToolInput {
  if (toolName === "apply_patch") {
    const raw =
      typeof parsed === "string"
        ? parsed
        : typeof parsed === "object" &&
            parsed !== null &&
            typeof (parsed as Record<string, unknown>).patch === "string"
          ? (parsed as { patch: string }).patch
          : null;
    if (raw === null) return { kind: "unknown", toolName, raw: parsed };
    return { kind: "patch", text: codexEnvelopeToUnifiedDiff(raw) };
  }

  const o =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  const str = (k: string): string =>
    typeof o[k] === "string" ? (o[k] as string) : "";

  switch (toolName) {
    case "exec_command":
    case "shell": {
      if (Array.isArray(o.command)) {
        return {
          kind: "bash",
          command: o.command
            .map((p) => (typeof p === "string" ? p : ""))
            .filter((p) => p.length > 0)
            .join(" "),
        };
      }
      const cmd = str("command") || str("cmd");
      return { kind: "bash", command: cmd };
    }
    case "read_file":
      return { kind: "read", filePath: str("path") || str("file_path") };
    case "web_fetch":
    case "fetch":
      return { kind: "fetch", url: str("url") };
    case "web_search":
    case "websearch":
      return { kind: "web_search", query: str("query") };
    case "skill":
    case "Skill": {
      const argsField = typeof o.args === "string" ? (o.args as string) : null;
      return {
        kind: "skill",
        name: str("skill") || str("name"),
        args: argsField && argsField.length > 0 ? argsField : null,
      };
    }
    case "update_plan": {
      const plan = Array.isArray(o.plan) ? o.plan : [];
      return {
        kind: "task",
        op: "write",
        summary: plan.length > 0 ? `${plan.length} steps` : null,
      };
    }
    case "spawn_agent": {
      return {
        kind: "send_message",
        to: str("agent_type") || str("agent"),
        content: str("message") || str("prompt"),
      };
    }
    case "send_input": {
      return {
        kind: "send_message",
        to: str("target") || str("agentId"),
        content: str("message") || str("content"),
      };
    }
    case "view_image":
      return { kind: "read", filePath: str("path") || str("file_path") };
    default:
      return { kind: "unknown", toolName, raw: parsed };
  }
}

function withDb<T>(
  fn: (db: DatabaseSync) => T,
  errorMsg: string,
  errorCtx: Record<string, unknown>,
  log?: Logger,
): T | null {
  return sharedWithDb<DatabaseSync, T>(openDb, fn, errorMsg, errorCtx, log);
}

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
export const loadCodexTranscript: Fetcher = (input, log) => {
  const rolloutPath = findRolloutPath(input.sessionId, log);
  if (!rolloutPath) return null;
  const raw = fs.readFileSync(rolloutPath, "utf8");
  const transcript: Transcript = {
    agentName: codexVocab.displayName,
    sessionId: input.sessionId,
    title: input.title,
    repoName: input.repoName,
    cwd: input.cwd,
    model: input.model,
    contextTokens: input.contextTokens,
    pr: input.pr,
    exportedAt: Date.now(),
    events: parseCodexRollout(raw),
  };
  return transcript;
};
