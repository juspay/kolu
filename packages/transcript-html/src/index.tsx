/** Render a `Transcript` to a small, self-contained HTML document.
 *
 *  The export has two modes:
 *  - `chat`: just the visible conversation, for reading and sharing
 *  - `full`: the same conversation plus collapsed audit details
 *
 *  Both modes deliberately avoid custom elements and syntax-highlighting
 *  payloads. Hidden export content is still file weight, so the lightweight
 *  chat mode omits non-conversation payloads instead of hiding them with CSS.
 *  The only runtime script is a tiny prompt-jump helper when a transcript has
 *  multiple human messages. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { escapeHtml } from "@kolu/html-escape";
import {
  MODE_LABEL,
  relativizeTranscript,
  type ToolInput,
  type Transcript,
  type TranscriptEvent,
  type TranscriptHtmlMode,
} from "kolu-transcript-core";
import { Marked } from "marked";

export type { TranscriptHtmlMode };

export interface TranscriptHtmlOptions {
  mode: TranscriptHtmlMode;
}

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const STYLES = readFileSync(join(SRC_DIR, "styles.css"), "utf8");
const SCRIPT = readFileSync(join(SRC_DIR, "script.js"), "utf8");

const AGENT_LABEL: Record<Transcript["agentKind"], string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  codex: "Codex",
};

const mdProse = makeMarked({ breaks: false });
const mdUser = makeMarked({ breaks: true });

function makeMarked(options: { breaks: boolean }): Marked {
  return new Marked({
    gfm: true,
    breaks: options.breaks,
    renderer: {
      code(token) {
        const lang = token.lang?.trim();
        const langAttr =
          lang && /^[A-Za-z0-9_-]+$/.test(lang)
            ? ` class="language-${escapeHtml(lang)}"`
            : "";
        return `<pre><code${langAttr}>${escapeHtml(token.text)}</code></pre>`;
      },
      html(token) {
        // marked passes raw HTML tokens (block and inline) through verbatim by
        // default. This document is built to be shared, so an assistant or user
        // message containing `<img src=x onerror=…>` or `<script>` would be
        // stored XSS in whoever opens the file. Escape raw HTML to its literal
        // text — also the faithful rendering of a transcript.
        return escapeHtml(token.text);
      },
      heading(token) {
        const text = this.parser.parseInline(token.tokens);
        const level = Math.min(token.depth + 2, 6);
        return `<h${level}>${text}</h${level}>`;
      },
      link(token) {
        const text = this.parser.parseInline(token.tokens);
        const titleAttr = token.title
          ? ` title="${escapeHtml(token.title)}"`
          : "";
        return `<a href="${escapeHtml(token.href)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
      },
    },
  });
}

async function renderMarkdown(text: string): Promise<string> {
  return await mdProse.parse(text);
}

async function renderUserMarkdown(text: string): Promise<string> {
  return await mdUser.parse(text);
}

function compactText(text: string, max: number): string {
  const compacted = text.replace(/\s+/g, " ").trim();
  return compacted.length > max ? `${compacted.slice(0, max - 1)}…` : compacted;
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ""
  );
}

function shortenPath(path: string): string {
  if (path.startsWith("./") || path.startsWith("../") || !path.includes("/"))
    return path;
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

function plainFromMarkdownLine(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+)/, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]\n]+)\]\([^)\n]+\)/g, "$1")
    .trim();
}

function plainPreviewFromMarkdown(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const cleaned = plainFromMarkdownLine(raw);
    if (cleaned.length > 0) return cleaned;
  }
  return "";
}

function deriveDisplayTitle(transcript: Transcript): string {
  for (const event of transcript.events) {
    if (event.kind === "user") {
      const preview = plainPreviewFromMarkdown(event.text);
      if (preview.length > 0)
        return preview.length > 120 ? `${preview.slice(0, 117)}…` : preview;
    }
  }
  if (transcript.title && transcript.title.length > 0) return transcript.title;
  return `Session ${transcript.sessionId.slice(0, 8)}`;
}

function formatTimestamp(ts: number | null): string {
  if (ts === null) return "";
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

function formatExportDate(value: number): string {
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return String(value);
  }
}

function formatTokens(value: number | null): string | null {
  if (value === null) return null;
  try {
    return new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(value);
  }
}

function eventCounts(events: TranscriptEvent[]): {
  user: number;
  assistant: number;
  detail: number;
} {
  let user = 0;
  let assistant = 0;
  let detail = 0;
  for (const event of events) {
    if (event.kind === "user") user++;
    else if (event.kind === "assistant") assistant++;
    else detail++;
  }
  return { user, assistant, detail };
}

function humanMessageCount(events: TranscriptEvent[]): number {
  return events.filter((event) => event.kind === "user").length;
}

function metaParts(transcript: Transcript, mode: TranscriptHtmlMode): string[] {
  const counts = eventCounts(transcript.events);
  const parts = [
    AGENT_LABEL[transcript.agentKind],
    MODE_LABEL[mode],
    `${counts.user} prompts`,
    `${counts.assistant} replies`,
  ];
  if (mode === "full") parts.push(`${counts.detail} details`);
  const tokens = formatTokens(transcript.contextTokens);
  if (tokens) parts.push(`${tokens} tokens`);
  if (transcript.cwd) parts.push(transcript.cwd);
  return parts;
}

function detailSummary(input: ToolInput): string {
  switch (input.kind) {
    case "edit":
      return `Edited ${shortenPath(input.filePath)}`;
    case "write":
      return `Wrote ${shortenPath(input.filePath)}`;
    case "patch":
      return `Applied patch${firstLine(input.text) ? `: ${compactText(firstLine(input.text), 90)}` : ""}`;
    case "read":
      return `Read ${shortenPath(input.filePath)}`;
    case "bash":
      return `Ran ${compactText(input.command, 100)}`;
    case "glob":
      return `Glob ${input.pattern}${input.path ? ` in ${shortenPath(input.path)}` : ""}`;
    case "grep":
      return `Grep ${input.pattern}${input.path ? ` in ${shortenPath(input.path)}` : ""}`;
    case "fetch":
      return `Fetched ${input.url}`;
    case "web_search":
      return `Searched ${compactText(input.query, 100)}`;
    case "skill":
      return `Skill ${input.name}${input.args ? `: ${compactText(input.args, 90)}` : ""}`;
    case "task":
      return `Task ${input.op}${input.summary ? `: ${compactText(input.summary, 90)}` : ""}`;
    case "ask":
      return `Asked ${compactText(input.question, 100)}`;
    case "plan_mode":
      return `Plan ${input.op}${input.plan ? `: ${compactText(input.plan, 90)}` : ""}`;
    case "worktree":
      return `Worktree ${input.op}${input.path ? `: ${input.path}` : ""}`;
    case "cron":
      return `Cron ${input.op}${input.summary ? `: ${compactText(input.summary, 90)}` : ""}`;
    case "monitor":
      return `Monitored ${compactText(input.command, 100)}`;
    case "lsp":
      return `LSP ${input.op}${input.summary ? `: ${compactText(input.summary, 90)}` : ""}`;
    case "mcp_resource":
      return `MCP ${input.op}${input.uri ? `: ${input.uri}` : ""}`;
    case "send_message":
      return `Message to ${input.to}: ${compactText(input.content, 80)}`;
    case "team":
      return `Team ${input.op}${input.summary ? `: ${compactText(input.summary, 90)}` : ""}`;
    case "tool_search":
      return `Tool search ${compactText(input.query, 100)}`;
    case "unknown":
      return `Tool ${input.toolName}`;
  }
}

function prettyJson(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? String(value);
}

function detailPre(value: unknown): string {
  return `<pre>${escapeHtml(prettyJson(value))}</pre>`;
}

function timestampHtml(ts: number | null): string {
  const formatted = formatTimestamp(ts);
  return formatted ? `<time>${escapeHtml(formatted)}</time>` : "";
}

async function renderChatEvent(
  event: Extract<TranscriptEvent, { kind: "user" | "assistant" }>,
  humanPosition: { index: number; total: number } | null,
): Promise<string> {
  const role = event.kind === "user" ? "Human" : "AI";
  const humanAttrs = humanPosition
    ? ` id="human-${humanPosition.index}" data-human-message tabindex="-1"`
    : "";
  const ariaLabel = humanPosition
    ? `${role} message ${humanPosition.index} of ${humanPosition.total}`
    : `${role} message`;
  const body =
    event.kind === "user"
      ? await renderUserMarkdown(event.text)
      : await renderMarkdown(event.text);
  const model =
    event.kind === "assistant" && event.model
      ? `<span class="model">${escapeHtml(event.model)}</span>`
      : "";
  return `<section class="message ${event.kind}"${humanAttrs} aria-label="${escapeHtml(ariaLabel)}">
  <header><strong class="speaker">${role}</strong>${model}${timestampHtml(event.ts)}</header>
  <div class="body">${body}</div>
</section>`;
}

function renderDetailEvent(event: TranscriptEvent): string {
  switch (event.kind) {
    case "reasoning":
      return `<details class="detail reasoning"><summary>Reasoning ${timestampHtml(event.ts)}</summary><div class="detail-body">${detailPre(event.text)}</div></details>`;
    case "tool_call":
      return `<details class="detail tool-call"><summary>${escapeHtml(detailSummary(event.inputs))} ${timestampHtml(event.ts)}</summary><div class="detail-body"><p class="muted">${escapeHtml(event.toolName)}</p>${detailPre(event.inputs)}</div></details>`;
    case "tool_result":
      return `<details class="detail tool-result${event.isError ? " error" : ""}"><summary>Tool result${event.isError ? " error" : ""} ${timestampHtml(event.ts)}</summary><div class="detail-body">${detailPre(event.output)}</div></details>`;
    case "subtask_start":
      return `<details class="detail subtask"><summary>Subtask: ${escapeHtml(event.description)} ${timestampHtml(event.ts)}</summary><div class="detail-body">${event.agentName ? `<p>Agent: ${escapeHtml(event.agentName)}</p>` : ""}${event.sessionId ? `<p>Session: <code>${escapeHtml(event.sessionId)}</code></p>` : ""}</div></details>`;
    case "subtask_end":
      return `<div class="detail-marker">End subtask</div>`;
    case "user":
    case "assistant":
      return "";
  }
}

async function renderEvents(
  events: TranscriptEvent[],
  mode: TranscriptHtmlMode,
): Promise<string> {
  const chunks: string[] = [];
  const humanTotal = humanMessageCount(events);
  let humanIndex = 0;
  for (const event of events) {
    if (event.kind === "user" || event.kind === "assistant") {
      const humanPosition =
        event.kind === "user"
          ? { index: ++humanIndex, total: humanTotal }
          : null;
      chunks.push(await renderChatEvent(event, humanPosition));
    } else if (mode === "full") {
      chunks.push(renderDetailEvent(event));
    }
  }
  return chunks.length > 0
    ? chunks.join("\n")
    : `<p class="empty">No conversation events found.</p>`;
}

function promptJumpHtml(humanTotal: number): string {
  if (humanTotal < 2) return "";
  return `<nav class="prompt-jump" aria-label="Human message navigation" data-prompt-nav>
  <button type="button" data-prompt-nav-action="prev" aria-label="Previous human message" title="Previous human message">↑</button>
  <button type="button" data-prompt-nav-action="next" aria-label="Next human message" title="Next human message">↓</button>
</nav>`;
}

function headerHtml(
  transcript: Transcript,
  title: string,
  mode: TranscriptHtmlMode,
): string {
  const repo =
    transcript.repoName || transcript.pr
      ? `<p class="repo-line">${transcript.repoName ? `<span>${escapeHtml(transcript.repoName)}</span>` : ""}${transcript.repoName && transcript.pr ? " · " : ""}${transcript.pr ? `<a href="${escapeHtml(transcript.pr.url)}" target="_blank" rel="noopener noreferrer">PR #${transcript.pr.number}</a>` : ""}</p>`
      : "";
  return `<header class="masthead">
  <p class="eyebrow">Kolu export · ${escapeHtml(formatExportDate(transcript.exportedAt))} · ${escapeHtml(transcript.sessionId.slice(0, 8))}</p>
  ${repo}
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${metaParts(transcript, mode).map(escapeHtml).join(" · ")}</p>
</header>`;
}

/** Convert a Transcript to a self-contained HTML document. */
export async function transcriptToHtml(
  transcript: Transcript,
  options: TranscriptHtmlOptions,
): Promise<string> {
  const prepared = relativizeTranscript(transcript);
  const title = deriveDisplayTitle(prepared);
  const humanTotal = humanMessageCount(prepared.events);
  const events = await renderEvents(prepared.events, options.mode);
  const promptJump = promptJumpHtml(humanTotal);
  const script = humanTotal >= 2 ? `<script>${SCRIPT}</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} — kolu ${MODE_LABEL[options.mode].toLowerCase()}</title>
<style>${STYLES}</style>
</head>
<body data-export-mode="${options.mode}">
<article class="document">
${headerHtml(prepared, title, options.mode)}
<main class="conversation">
${events}
</main>
<footer>Exported by <a href="https://kolu.dev/" target="_blank" rel="noopener noreferrer">Kolu</a>.</footer>
</article>
${promptJump}
${script}
</body>
</html>
`;
}
