/** Render a `Transcript` to a self-contained HTML document.
 *
 *  Pure function: no I/O, no side effects, no Node-only APIs (so the
 *  same renderer could move to a shared package later if a CLI export
 *  path appears). Dispatches only on `event.kind` — never on
 *  `transcript.agentKind` — so a new vendor's tool name needs zero
 *  changes here. The agentKind is rendered as a header label.
 *
 *  Interactivity is inline: tool-call cards use `<details>`, prompt
 *  navigation is bound in a small embedded `<script>`. No external CSS,
 *  no external JS, no fonts to load. The result is one string the
 *  client wraps in a Blob and opens in a new tab. */

import type { Transcript, TranscriptEvent } from "kolu-common";
import { match } from "ts-pattern";

const AGENT_LABEL: Record<Transcript["agentKind"], string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  codex: "Codex",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON-stringify with a 2-space indent. Falls back to the empty string
 *  on `undefined` so the rendered card stays empty rather than showing
 *  literal "undefined". */
function prettyJson(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTimestamp(ts: number | null): string {
  if (ts === null) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

function renderEvent(event: TranscriptEvent, index: number): string {
  const ts = formatTimestamp(event.ts);
  const tsHtml = ts ? `<span class="ts">${escapeHtml(ts)}</span>` : "";
  return match(event)
    .with({ kind: "user" }, (e) => {
      return `<section class="event user" data-role="user" data-prompt-index="${index}">
  <header>
    <span class="role">User</span>
    ${tsHtml}
  </header>
  <pre class="text">${escapeHtml(e.text)}</pre>
</section>`;
    })
    .with({ kind: "assistant" }, (e) => {
      const model = e.model
        ? `<span class="model">${escapeHtml(e.model)}</span>`
        : "";
      return `<section class="event assistant">
  <header>
    <span class="role">Assistant</span>
    ${model}
    ${tsHtml}
  </header>
  <pre class="text">${escapeHtml(e.text)}</pre>
</section>`;
    })
    .with({ kind: "reasoning" }, (e) => {
      return `<section class="event reasoning">
  <details>
    <summary><span class="role">Reasoning</span>${tsHtml}</summary>
    <pre class="text">${escapeHtml(e.text)}</pre>
  </details>
</section>`;
    })
    .with({ kind: "tool_call" }, (e) => {
      const inputs = prettyJson(e.inputs);
      return `<section class="event tool-call" data-call-id="${escapeHtml(e.id ?? "")}">
  <details>
    <summary>
      <span class="role">Tool call</span>
      <span class="tool-name">${escapeHtml(e.toolName)}</span>
      ${tsHtml}
    </summary>
    <pre class="json">${escapeHtml(inputs)}</pre>
  </details>
</section>`;
    })
    .with({ kind: "tool_result" }, (e) => {
      const output = prettyJson(e.output);
      const errCls = e.isError ? " is-error" : "";
      const errLabel = e.isError ? " (error)" : "";
      return `<section class="event tool-result${errCls}" data-call-id="${escapeHtml(e.id ?? "")}">
  <details>
    <summary>
      <span class="role">Tool result${errLabel}</span>
      ${tsHtml}
    </summary>
    <pre class="json">${escapeHtml(output)}</pre>
  </details>
</section>`;
    })
    .exhaustive();
}

/** Tally event counts for the header summary line. */
function countEvents(events: TranscriptEvent[]): {
  user: number;
  assistant: number;
  toolCalls: number;
} {
  let user = 0;
  let assistant = 0;
  let toolCalls = 0;
  for (const e of events) {
    if (e.kind === "user") user++;
    else if (e.kind === "assistant") assistant++;
    else if (e.kind === "tool_call") toolCalls++;
  }
  return { user, assistant, toolCalls };
}

const STYLE = `
  :root {
    --bg: #0e0e10;
    --surface: #16161a;
    --surface-2: #1e1e23;
    --edge: #2a2a30;
    --fg: #e6e6e8;
    --fg-2: #a8a8b0;
    --fg-3: #6a6a72;
    --accent: #7aa2f7;
    --user: #9ece6a;
    --tool: #e0af68;
    --error: #f7768e;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #fafafa;
      --surface: #ffffff;
      --surface-2: #f1f1f3;
      --edge: #e1e1e6;
      --fg: #1a1a1a;
      --fg-2: #4a4a52;
      --fg-3: #8a8a92;
      --accent: #2c5db8;
      --user: #2f7a30;
      --tool: #a86a00;
      --error: #c43b53;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  header.doc {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--surface);
    border-bottom: 1px solid var(--edge);
    padding: 0.75rem 1.25rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: baseline;
  }
  header.doc h1 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
    color: var(--fg);
  }
  header.doc .meta {
    font-size: 0.8125rem;
    color: var(--fg-2);
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  header.doc .meta code { color: var(--fg-3); font-size: 0.75rem; }
  header.doc .nav {
    margin-left: auto;
    display: flex;
    gap: 0.25rem;
    align-items: center;
    font-size: 0.8125rem;
    color: var(--fg-2);
  }
  header.doc .nav button {
    background: var(--surface-2);
    color: var(--fg);
    border: 1px solid var(--edge);
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    font: inherit;
    line-height: 1;
  }
  header.doc .nav button:hover { background: var(--edge); }
  header.doc .nav .pos { font-variant-numeric: tabular-nums; padding: 0 0.5rem; }
  header.doc .hint {
    width: 100%;
    color: var(--fg-3);
    font-size: 0.75rem;
  }
  main {
    max-width: 64rem;
    margin: 0 auto;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .event {
    border: 1px solid var(--edge);
    border-radius: 8px;
    background: var(--surface);
    padding: 0.75rem 1rem;
  }
  .event.user {
    border-left: 3px solid var(--user);
    scroll-margin-top: 5rem;
  }
  .event.user.is-current { box-shadow: 0 0 0 2px var(--user); }
  .event.assistant { border-left: 3px solid var(--accent); }
  .event.reasoning { background: var(--surface-2); }
  .event.tool-call { border-left: 3px solid var(--tool); }
  .event.tool-result { border-left: 3px solid var(--tool); }
  .event.tool-result.is-error { border-left-color: var(--error); }
  .event header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    color: var(--fg-2);
    font-size: 0.8125rem;
    margin-bottom: 0.375rem;
  }
  .event .role { font-weight: 600; color: var(--fg); }
  .event .model { color: var(--fg-3); font-size: 0.75rem; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .event .tool-name { font-family: ui-monospace, "SF Mono", Menlo, monospace; color: var(--tool); }
  .event .ts { color: var(--fg-3); font-size: 0.75rem; margin-left: auto; }
  .event details summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    color: var(--fg-2);
    font-size: 0.8125rem;
  }
  .event details summary::-webkit-details-marker { display: none; }
  .event details summary::before {
    content: "▸";
    color: var(--fg-3);
    font-size: 0.75rem;
    transition: transform 0.1s;
    display: inline-block;
  }
  .event details[open] summary::before { transform: rotate(90deg); }
  pre.text, pre.json {
    margin: 0.5rem 0 0 0;
    padding: 0.625rem 0.75rem;
    background: var(--bg);
    border: 1px solid var(--edge);
    border-radius: 6px;
    color: var(--fg);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.8125rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
  }
  pre.text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .empty {
    color: var(--fg-3);
    text-align: center;
    padding: 3rem 1rem;
    font-style: italic;
  }
`;

/** Inline JS for prev/next-prompt navigation. Pure DOM, no deps. */
const SCRIPT = `
(function () {
  const prompts = Array.from(document.querySelectorAll('[data-role="user"]'));
  const total = prompts.length;
  const posEl = document.querySelector('[data-nav-pos]');
  const totalEl = document.querySelector('[data-nav-total]');
  if (totalEl) totalEl.textContent = String(total);
  let cur = -1;

  function highlight(idx) {
    prompts.forEach((p, i) => p.classList.toggle('is-current', i === idx));
    if (posEl) posEl.textContent = idx >= 0 ? String(idx + 1) : '–';
  }

  function jumpTo(idx) {
    if (total === 0) return;
    const next = ((idx % total) + total) % total;
    cur = next;
    prompts[next].scrollIntoView({ behavior: 'smooth', block: 'start' });
    highlight(next);
  }

  document.querySelector('[data-nav="prev"]')?.addEventListener('click', () => jumpTo(cur - 1));
  document.querySelector('[data-nav="next"]')?.addEventListener('click', () => jumpTo(cur + 1));

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement) {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); jumpTo(cur + 1); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); jumpTo(cur - 1); }
  });

  highlight(-1);
})();
`;

/** Convert a Transcript to a self-contained HTML document. */
export function transcriptToHtml(transcript: Transcript): string {
  const counts = countEvents(transcript.events);
  const eventsHtml =
    transcript.events.length === 0
      ? '<div class="empty">No conversation events found.</div>'
      : transcript.events.map((e, i) => renderEvent(e, i)).join("\n");
  const titleText =
    transcript.title && transcript.title.length > 0
      ? transcript.title
      : `Session ${transcript.sessionId.slice(0, 8)}`;
  const cwdLine = transcript.cwd
    ? `<span><code>${escapeHtml(transcript.cwd)}</code></span>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(titleText)} — kolu</title>
<style>${STYLE}</style>
</head>
<body>
<header class="doc">
  <h1>${escapeHtml(titleText)}</h1>
  <div class="meta">
    <span>${escapeHtml(AGENT_LABEL[transcript.agentKind])}</span>
    ${cwdLine}
    <span>${counts.user} prompts · ${counts.assistant} replies · ${counts.toolCalls} tool calls</span>
    <span>Exported ${escapeHtml(formatTimestamp(transcript.exportedAt))}</span>
  </div>
  <nav class="nav" aria-label="Prompt navigation">
    <button type="button" data-nav="prev" title="Previous prompt (k)">↑</button>
    <span class="pos"><span data-nav-pos>–</span> / <span data-nav-total>0</span></span>
    <button type="button" data-nav="next" title="Next prompt (j)">↓</button>
  </nav>
  <div class="hint">Use <kbd>j</kbd>/<kbd>k</kbd> or arrow keys to jump between user prompts. Click any header to collapse.</div>
</header>
<main>
${eventsHtml}
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
