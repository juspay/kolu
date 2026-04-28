/**
 * Agent transcript export — reads on-disk transcript data for the active
 * agent session and renders it as a self-contained HTML document.
 *
 * Each agent integration stores its transcript differently:
 *  - Claude Code: JSONL at ~/.claude/projects/{encoded-cwd}/{sessionId}.jsonl
 *  - OpenCode:    SQLite at ~/.local/share/opencode/opencode.db (message + part tables)
 *  - Codex:       JSONL rollout at ~/.codex/sessions/.../rollout-*.jsonl
 *
 * The export reads the full transcript, parses messages, and generates
 * styled HTML suitable for offline viewing or archival.
 */

import fs from "node:fs";
import path from "node:path";
import { encodeProjectPath, PROJECTS_DIR } from "kolu-claude-code";
import { findSessionByDirectory as findCodexSession } from "kolu-codex";
import {
  findSessionByDirectory as findOpenCodeSession,
  openDb as openOpenCodeDb,
} from "kolu-opencode";
import type { AgentInfo } from "kolu-common";
import type { TerminalProcess } from "../terminal-registry.ts";

interface TranscriptMessage {
  role: "user" | "assistant";
  parts: TranscriptPart[];
  model?: string;
}

type TranscriptPart =
  | { kind: "text"; content: string }
  | { kind: "tool_use"; name: string; input: string }
  | { kind: "tool_result"; output: string }
  | { kind: "thinking"; content: string };

const agentNames: Record<AgentInfo["kind"], string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  codex: "Codex",
};

export function exportAgentTranscript(entry: TerminalProcess): string {
  const agent = entry.info.meta.agent;
  if (!agent) throw new Error("No agent session in this terminal");

  const cwd = entry.info.meta.cwd;
  const messages = readTranscript(agent, cwd);
  return renderHtml(messages, agent);
}

function readTranscript(agent: AgentInfo, cwd: string): TranscriptMessage[] {
  switch (agent.kind) {
    case "claude-code":
      return readClaudeCodeTranscript(agent.sessionId, cwd);
    case "opencode":
      return readOpenCodeTranscript(agent.sessionId, cwd);
    case "codex":
      return readCodexTranscript(cwd);
  }
}

function readClaudeCodeTranscript(
  sessionId: string,
  cwd: string,
): TranscriptMessage[] {
  const projectDir = path.join(PROJECTS_DIR, encodeProjectPath(cwd));
  const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);

  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }

  const messages: TranscriptMessage[] = [];
  const pendingToolResults = new Map<
    string,
    { name: string; output: string }
  >();

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = entry.type as string | undefined;
    const message = entry.message as
      | {
          role?: string;
          content?: unknown[];
          model?: string;
          stop_reason?: string | null;
        }
      | undefined;

    if (type === "user" && message?.role === "user") {
      const parts: TranscriptPart[] = [];
      const content = message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            parts.push({ kind: "text", content: b.text });
          } else if (
            b.type === "tool_result" &&
            typeof b.tool_use_id === "string"
          ) {
            const output =
              typeof b.content === "string"
                ? b.content
                : JSON.stringify(b.content, null, 2);
            const pending = pendingToolResults.get(b.tool_use_id);
            if (pending) {
              pending.output = output;
            } else {
              parts.push({ kind: "tool_result", output });
            }
          }
        }
      }
      if (parts.length > 0) {
        messages.push({ role: "user", parts });
      }
    } else if (type === "assistant" && message?.role === "assistant") {
      const parts: TranscriptPart[] = [];
      const content = message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") {
            parts.push({ kind: "text", content: b.text });
          } else if (b.type === "thinking" && typeof b.thinking === "string") {
            parts.push({ kind: "thinking", content: b.thinking });
          } else if (
            b.type === "tool_use" &&
            typeof b.name === "string" &&
            typeof b.id === "string"
          ) {
            const input =
              typeof b.input === "object" && b.input !== null
                ? JSON.stringify(b.input, null, 2)
                : String(b.input ?? "");
            parts.push({ kind: "tool_use", name: b.name, input });
            pendingToolResults.set(b.id, {
              name: b.name,
              output: "",
            });
          }
        }
      }
      if (parts.length > 0) {
        messages.push({ role: "assistant", parts, model: message.model });
      }
    }
  }

  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.kind === "tool_result" && !part.output) {
        for (const [, pending] of pendingToolResults) {
          if (pending.output) {
            part.output = pending.output;
            break;
          }
        }
      }
    }
  }

  return messages;
}

function readOpenCodeTranscript(
  sessionId: string,
  cwd: string,
): TranscriptMessage[] {
  const db = openOpenCodeDb();
  if (!db) return [];
  try {
    const session = findOpenCodeSession(cwd);
    if (!session) return [];

    const rows = db
      .prepare(
        "SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created ASC",
      )
      .all(sessionId) as {
      id: string;
      data: string;
      time_created: number;
    }[];

    const messages: TranscriptMessage[] = [];
    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data) as Record<string, unknown>;
      } catch {
        continue;
      }

      const role = data.role as string | undefined;
      if (role !== "user" && role !== "assistant") continue;

      const parts = extractOpenCodeParts(db, row.id, data);
      if (parts.length > 0) {
        messages.push({
          role: role as "user" | "assistant",
          parts,
          model: (data.modelID as string) ?? undefined,
        });
      }
    }
    return messages;
  } finally {
    db.close();
  }
}

function extractOpenCodeParts(
  db: import("node:sqlite").DatabaseSync,
  messageId: string,
  data: Record<string, unknown>,
): TranscriptPart[] {
  const parts: TranscriptPart[] = [];

  try {
    const partRows = db
      .prepare("SELECT data FROM part WHERE message_id = ? ORDER BY rowid ASC")
      .all(messageId) as { data: string }[];

    for (const pr of partRows) {
      let partData: Record<string, unknown>;
      try {
        partData = JSON.parse(pr.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const partType = partData.type as string | undefined;
      if (partType === "text") {
        const text =
          (partData.content as string) ?? (partData.text as string) ?? "";
        if (text) parts.push({ kind: "text", content: text });
      } else if (partType === "tool") {
        const name =
          (partData.name as string) ?? (partData.toolName as string) ?? "tool";
        const inputObj = partData.input ?? partData.args ?? partData.parameters;
        const input =
          typeof inputObj === "object" && inputObj !== null
            ? JSON.stringify(inputObj, null, 2)
            : "";
        parts.push({ kind: "tool_use", name, input });
        const output = partData.output ?? partData.result;
        if (output !== undefined && output !== null) {
          parts.push({
            kind: "tool_result",
            output:
              typeof output === "string"
                ? output
                : JSON.stringify(output, null, 2),
          });
        }
      }
    }
  } catch {
    // part table may not exist or have unexpected schema
  }

  if (parts.length === 0) {
    const content = data.content as string | undefined;
    if (content) parts.push({ kind: "text", content });
  }

  return parts;
}

function readCodexTranscript(cwd: string): TranscriptMessage[] {
  const session = findCodexSession(cwd);
  if (!session) return [];

  let raw: string;
  try {
    raw = fs.readFileSync(session.rolloutPath, "utf8");
  } catch {
    return [];
  }

  const messages: TranscriptMessage[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const outerType = entry.type as string | undefined;
    const payload = entry.payload as Record<string, unknown> | undefined;
    if (!payload) continue;

    const innerType = payload.type as string | undefined;

    if (outerType === "response_item") {
      if (innerType === "message") {
        const content = payload.content as
          | Array<Record<string, unknown>>
          | undefined;
        if (!Array.isArray(content)) continue;
        const parts: TranscriptPart[] = [];
        for (const block of content) {
          if (block.type === "output_text" && typeof block.text === "string") {
            parts.push({ kind: "text", content: block.text });
          }
        }
        if (parts.length > 0) {
          messages.push({ role: "assistant", parts });
        }
      } else if (innerType === "function_call") {
        const name = (payload.name as string) ?? "tool";
        const args = payload.arguments ?? payload.input ?? payload.parameters;
        const input =
          typeof args === "object" && args !== null
            ? JSON.stringify(args, null, 2)
            : String(args ?? "");
        messages.push({
          role: "assistant",
          parts: [{ kind: "tool_use", name, input }],
        });
      } else if (innerType === "function_call_output") {
        const output = payload.output ?? payload.content ?? "";
        messages.push({
          role: "user",
          parts: [
            {
              kind: "tool_result",
              output:
                typeof output === "string"
                  ? output
                  : JSON.stringify(output, null, 2),
            },
          ],
        });
      }
    }
  }

  return messages;
}

function renderHtml(messages: TranscriptMessage[], agent: AgentInfo): string {
  const title = escapeHtml(
    agent.summary ?? `${agentNames[agent.kind]} session`,
  );
  const agentName = agentNames[agent.kind];
  const model = agent.model ? escapeHtml(agent.model) : "";
  const sessionId = agent.sessionId.slice(0, 8);
  const exported = new Date().toISOString().replace("T", " ").slice(0, 19);

  const body = messages.map(renderMessage).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title} — ${agentName} export</title>
<style>
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  max-width: 52rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  color: #1a1a1a;
  background: #fff;
  line-height: 1.6;
}
.export-header {
  border-bottom: 2px solid #f0f0f0;
  padding-bottom: 1.5rem;
  margin-bottom: 2rem;
}
.export-header h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
.export-meta { color: #666; font-size: 0.875rem; }
.export-meta span + span::before { content: " \\00b7 "; }
.message { margin-bottom: 1.5rem; }
.message-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
}
.message.user .message-label { color: #059669; }
.message.assistant .message-label { color: #b45309; }
.message-body {
  background: #f9fafb;
  border-radius: 8px;
  padding: 1rem;
}
.message.user .message-body { background: #f0fdf4; }
.message-text { white-space: pre-wrap; word-break: break-word; }
.tool-call {
  background: #f5f5f5;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
  padding: 0.75rem;
  margin: 0.75rem 0;
  font-size: 0.875rem;
}
.tool-call-header {
  font-weight: 600;
  color: #555;
  margin-bottom: 0.5rem;
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 0.8rem;
}
.tool-call-body {
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}
.tool-result {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  padding: 0.75rem;
  margin: 0.75rem 0;
  font-size: 0.875rem;
}
.tool-result-header {
  font-weight: 600;
  color: #1d4ed8;
  margin-bottom: 0.5rem;
  font-size: 0.8rem;
}
.tool-result-body {
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}
.thinking-block {
  color: #999;
  font-style: italic;
  border-left: 3px solid #e5e5e5;
  padding-left: 0.75rem;
  margin: 0.75rem 0;
}
@media print {
  body { max-width: none; padding: 0; }
  .tool-call-body, .tool-result-body { max-height: none; }
}
</style>
</head>
<body>
<div class="export-header">
<h1>${title}</h1>
<div class="export-meta">
<span>${escapeHtml(agentName)}</span>${model ? `<span>${model}</span>` : ""}<span>session ${escapeHtml(sessionId)}</span><span>exported ${escapeHtml(exported)}</span>
</div>
</div>
${body}
</body>
</html>`;
}

function renderMessage(msg: TranscriptMessage): string {
  const label = msg.role === "user" ? "You" : "Assistant";
  const modelTag = msg.model
    ? ` <span style="font-weight:400;opacity:0.6">${escapeHtml(msg.model)}</span>`
    : "";
  const partsHtml = msg.parts.map(renderPart).join("\n");
  return `<div class="message ${msg.role}">
<div class="message-label">${label}${modelTag}</div>
<div class="message-body">${partsHtml}</div>
</div>`;
}

function renderPart(part: TranscriptPart): string {
  switch (part.kind) {
    case "text":
      return `<div class="message-text">${escapeHtml(part.content)}</div>`;
    case "thinking":
      return `<div class="thinking-block">${escapeHtml(part.content)}</div>`;
    case "tool_use":
      return `<div class="tool-call">
<div class="tool-call-header">${escapeHtml(part.name)}</div>
${part.input ? `<div class="tool-call-body">${escapeHtml(part.input)}</div>` : ""}
</div>`;
    case "tool_result":
      return `<div class="tool-result">
<div class="tool-result-header">Result</div>
<div class="tool-result-body">${escapeHtml(part.output)}</div>
</div>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
