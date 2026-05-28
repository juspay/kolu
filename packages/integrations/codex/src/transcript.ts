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
import type { Logger } from "kolu-shared";
import { withDb as sharedWithDb } from "kolu-shared/sqlite";
import {
  type Fetcher,
  parseIsoTimestamp,
  type ToolInput,
  type Transcript,
  type TranscriptEvent,
} from "kolu-transcript-core";
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

/** Convert Codex's `*** Begin Patch` envelope to standard unified
 *  diff. Codex emits OpenAI's bespoke wire format with `*** Add File`,
 *  `*** Update File`, `*** Delete File`, optional `*** Move to`, and
 *  bare `@@` markers between hunks (no line numbers). We translate it
 *  to git-style unified diff so the typed-IR contract stays simple
 *  (`kind: "patch"` always carries unified-diff text) and the renderer
 *  needs no Codex-specific knowledge.
 *
 *  Hunk-line numbers in the synthesized output are conservative
 *  placeholders (`@@ -1,N +1,M @@` for every hunk) — Codex's envelope
 *  doesn't carry real line numbers, and the diff parsers Pierre uses
 *  treat them as display-only. Add/Delete files use the standard
 *  `@@ -0,0 +1,N @@` / `@@ -1,N +0,0 @@` shape so renderers detect
 *  the new/deleted state.
 *
 *  Input that doesn't start with `*** Begin Patch` is returned
 *  unchanged — older Codex revisions emit unified diff directly. */
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
          // Bare line (no prefix) — treat as context.
          hunk.push(` ${l}`);
        }
        i++;
      }
      flushHunk();
      continue;
    }
    // Unknown marker / stray line — skip.
    i++;
  }
  return out.join("\n");
}

/** Map a Codex tool name + parsed arguments onto the typed `ToolInput`
 *  union. `apply_patch` is a `custom_tool_call` whose argument is the
 *  patch text (not JSON); other tools carry JSON-encoded structured
 *  arguments. Exported for testing. */
export function normalizeCodexToolInput(
  toolName: string,
  parsed: unknown,
): ToolInput {
  // apply_patch's payload is the patch text itself. Codex emits
  // OpenAI's `*** Begin Patch / *** Update File / *** Add File`
  // envelope, not standard unified diff — convert it here so the
  // IR's `kind: "patch"` always carries unified-diff text and the
  // renderer doesn't need to know about Codex's wire format.
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
      // Codex's exec_command historically used `cmd` (a string command);
      // newer versions use `command` (often an array of argv). Accept
      // both, joining argv with spaces for display.
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
      // Codex doesn't ship Skills today, but if a future release lands
      // a Skill-shaped tool, we want it to round-trip through the
      // typed union rather than silently degrade to `unknown`.
      const argsField = typeof o.args === "string" ? (o.args as string) : null;
      return {
        kind: "skill",
        name: str("skill") || str("name"),
        args: argsField && argsField.length > 0 ? argsField : null,
      };
    }
    case "update_plan": {
      // Codex's TODO/plan tool. Payload is `{ plan: [{ step, status }] }`.
      const plan = Array.isArray(o.plan) ? o.plan : [];
      return {
        kind: "task",
        op: "write",
        summary: plan.length > 0 ? `${plan.length} steps` : null,
      };
    }
    case "spawn_agent": {
      // Codex subagent dispatch. `agent_type` is the recipient's
      // role/preset; `message` is the directive prompt. Surfacing
      // through `send_message` lets the renderer show
      // "Message → explorer: Task: research…" inline.
      return {
        kind: "send_message",
        to: str("agent_type") || str("agent"),
        content: str("message") || str("prompt"),
      };
    }
    case "send_input": {
      // Send keystrokes / a follow-up message to an existing subagent.
      // Same shape conceptually as Claude Code's `SendMessage`.
      return {
        kind: "send_message",
        to: str("target") || str("agentId"),
        content: str("message") || str("content"),
      };
    }
    case "view_image":
      // Codex's image-viewing tool — semantically equivalent to a
      // `read` against a binary file. The renderer's "Read · …/path"
      // summary is exactly the right shape.
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
export const loadCodexTranscript: Fetcher = (input, log) => {
  const rolloutPath = findRolloutPath(input.sessionId, log);
  if (!rolloutPath) return null;
  const raw = fs.readFileSync(rolloutPath, "utf8");
  const transcript: Transcript = {
    agentKind: "codex",
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
