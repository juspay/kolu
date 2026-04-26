/** Render a `Transcript` to a self-contained HTML document.
 *
 *  Pure function: no I/O, no side effects, no Node-only APIs (so the
 *  same renderer could move to a shared package later if a CLI export
 *  path appears). Dispatches only on `event.kind` — never on
 *  `transcript.agentKind` — so a new vendor's tool name needs zero
 *  changes here. The agentKind is rendered as a header label.
 *
 *  Interactivity is inline: tool-call cards use `<details>`, prompt
 *  navigation, hide-tool-calls toggle, and light/dark mode toggle are
 *  bound in a small embedded `<script>`. */

import type { Transcript, TranscriptEvent } from "kolu-common";
import { match } from "ts-pattern";

const AGENT_LABEL: Record<Transcript["agentKind"], string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  codex: "Codex",
};

/** Inline SVGs for role badges. Styled with `currentColor` so they pick
 *  up the surrounding `--user`/`--accent`/`--tool` accents. */
const USER_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21v-1a8 8 0 0 1 16 0v1"></path></svg>';
const ASSISTANT_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="2"></rect><path d="M12 7V3"></path><circle cx="12" cy="3" r="0.5" fill="currentColor"></circle><circle cx="9" cy="13" r="1" fill="currentColor"></circle><circle cx="15" cy="13" r="1" fill="currentColor"></circle><path d="M9 17h6"></path><path d="M2 13v2"></path><path d="M22 13v2"></path></svg>';
const REASONING_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6c0 2 1 3 1 5h10c0-2 1-3 1-5a6 6 0 0 0-6-6z"></path><path d="M9 19h6"></path><path d="M10 22h4"></path></svg>';
const TOOL_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5 2.5-2.5z"></path></svg>';

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

/** Compact-format a token count: 12 → "12", 1234 → "1.2K", 47000 → "47K". */
function formatTokens(n: number): string {
  try {
    return new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return String(n);
  }
}

function renderEvent(event: TranscriptEvent, index: number): string {
  const ts = formatTimestamp(event.ts);
  const tsHtml = ts ? `<span class="ts">${escapeHtml(ts)}</span>` : "";
  return match(event)
    .with({ kind: "user" }, (e) => {
      return `<section class="event user" data-role="user" data-prompt-index="${index}">
  <div class="icon" aria-label="User">${USER_ICON}</div>
  <div class="body">
    <header>
      <span class="role">User</span>
      ${tsHtml}
    </header>
    <pre class="text">${escapeHtml(e.text)}</pre>
  </div>
</section>`;
    })
    .with({ kind: "assistant" }, (e) => {
      const model = e.model
        ? `<span class="model">${escapeHtml(e.model)}</span>`
        : "";
      return `<section class="event assistant">
  <div class="icon" aria-label="Assistant">${ASSISTANT_ICON}</div>
  <div class="body">
    <header>
      <span class="role">Assistant</span>
      ${model}
      ${tsHtml}
    </header>
    <pre class="text">${escapeHtml(e.text)}</pre>
  </div>
</section>`;
    })
    .with({ kind: "reasoning" }, (e) => {
      return `<section class="event reasoning">
  <div class="icon" aria-label="Reasoning">${REASONING_ICON}</div>
  <div class="body">
    <details>
      <summary><span class="role">Reasoning</span>${tsHtml}</summary>
      <pre class="text">${escapeHtml(e.text)}</pre>
    </details>
  </div>
</section>`;
    })
    .with({ kind: "tool_call" }, (e) => {
      const inputs = prettyJson(e.inputs);
      return `<section class="event tool-call" data-call-id="${escapeHtml(e.id ?? "")}">
  <div class="icon" aria-label="Tool call">${TOOL_ICON}</div>
  <div class="body">
    <details>
      <summary>
        <span class="role">Tool call</span>
        <span class="tool-name">${escapeHtml(e.toolName)}</span>
        ${tsHtml}
      </summary>
      <pre class="json">${escapeHtml(inputs)}</pre>
    </details>
  </div>
</section>`;
    })
    .with({ kind: "tool_result" }, (e) => {
      const output = prettyJson(e.output);
      const errCls = e.isError ? " is-error" : "";
      const errLabel = e.isError ? " (error)" : "";
      return `<section class="event tool-result${errCls}" data-call-id="${escapeHtml(e.id ?? "")}">
  <div class="icon" aria-label="Tool result">${TOOL_ICON}</div>
  <div class="body">
    <details>
      <summary>
        <span class="role">Tool result${errLabel}</span>
        ${tsHtml}
      </summary>
      <pre class="json">${escapeHtml(output)}</pre>
    </details>
  </div>
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

/** Light/dark colors are driven by `prefers-color-scheme` by default,
 *  but `[data-theme="light"]` / `[data-theme="dark"]` on `<html>`
 *  overrides it for a manual choice. The selectors live in this exact
 *  order so the manual override always wins regardless of the system
 *  preference. */
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
  :root[data-theme="dark"] {
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
  :root[data-theme="light"] {
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
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); }
  header.doc {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--surface);
    border-bottom: 1px solid var(--edge);
    padding: 0.625rem 1.25rem;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem 1rem;
    align-items: center;
  }
  header.doc h1 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
    color: var(--fg);
  }
  header.doc .meta {
    grid-column: 1 / -1;
    font-size: 0.8125rem;
    color: var(--fg-2);
    display: flex;
    gap: 0.625rem 1rem;
    flex-wrap: wrap;
    align-items: center;
  }
  header.doc .meta .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.125rem 0.5rem;
    background: var(--surface-2);
    border: 1px solid var(--edge);
    border-radius: 999px;
    font-size: 0.75rem;
    color: var(--fg-2);
  }
  header.doc .meta .pill.agent { color: var(--accent); border-color: var(--accent); }
  header.doc .meta .pill.tokens { font-variant-numeric: tabular-nums; }
  header.doc .meta .pill.pr { color: var(--user); }
  header.doc .meta .pill code { color: inherit; font-size: inherit; }
  header.doc .meta a { text-decoration: none; }
  header.doc .meta a:hover { text-decoration: underline; }
  header.doc .controls {
    display: flex;
    gap: 0.375rem;
    align-items: center;
    font-size: 0.8125rem;
    color: var(--fg-2);
    justify-self: end;
  }
  header.doc .controls button,
  header.doc .controls label {
    background: var(--surface-2);
    color: var(--fg);
    border: 1px solid var(--edge);
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    font: inherit;
    line-height: 1;
    user-select: none;
  }
  header.doc .controls button:hover,
  header.doc .controls label:hover { background: var(--edge); }
  header.doc .controls input[type="checkbox"] { margin: 0 0.25rem 0 0; vertical-align: -2px; }
  header.doc .controls .pos { font-variant-numeric: tabular-nums; padding: 0 0.5rem; }
  header.doc .hint {
    grid-column: 1 / -1;
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
  body[data-hide-tools="true"] main .event.tool-call,
  body[data-hide-tools="true"] main .event.tool-result {
    display: none;
  }
  .event {
    display: grid;
    grid-template-columns: 2.25rem 1fr;
    gap: 0.5rem;
    border: 1px solid var(--edge);
    border-radius: 8px;
    background: var(--surface);
    padding: 0.75rem 1rem;
  }
  .event .icon {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    color: var(--fg-3);
    padding-top: 0.125rem;
  }
  .event .body { min-width: 0; }
  .event.user { border-left: 3px solid var(--user); scroll-margin-top: 5rem; }
  .event.user .icon { color: var(--user); }
  .event.user.is-current { box-shadow: 0 0 0 2px var(--user); }
  .event.assistant { border-left: 3px solid var(--accent); }
  .event.assistant .icon { color: var(--accent); }
  .event.reasoning { background: var(--surface-2); }
  .event.reasoning .icon { color: var(--fg-3); }
  .event.tool-call,
  .event.tool-result { border-left: 3px solid var(--tool); }
  .event.tool-call .icon,
  .event.tool-result .icon { color: var(--tool); }
  .event.tool-result.is-error { border-left-color: var(--error); }
  .event.tool-result.is-error .icon { color: var(--error); }
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

/** Inline JS for prev/next-prompt navigation, the hide-tool-calls
 *  checkbox, and theme cycling (auto → light → dark → auto). State for
 *  the toggles persists in `localStorage` under stable keys so a reopen
 *  remembers the user's preference. Pure DOM, no deps. */
const SCRIPT = `
(function () {
  // --- Prompt navigation ---
  const prompts = Array.from(document.querySelectorAll('section.user[data-role="user"]'));
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

  // --- Hide tool calls toggle (persisted) ---
  const toolToggle = document.querySelector('[data-toggle="tools"]');
  function applyTools(hide) {
    document.body.dataset.hideTools = String(hide);
    if (toolToggle instanceof HTMLInputElement) toolToggle.checked = hide;
  }
  applyTools(localStorage.getItem('kolu-export-hide-tools') === '1');
  toolToggle?.addEventListener('change', (e) => {
    const hide = e.target instanceof HTMLInputElement && e.target.checked;
    localStorage.setItem('kolu-export-hide-tools', hide ? '1' : '0');
    applyTools(hide);
  });

  // --- Theme cycle (auto → light → dark → auto) ---
  const themeBtn = document.querySelector('[data-toggle="theme"]');
  const labels = { auto: 'Theme: auto', light: 'Theme: light', dark: 'Theme: dark' };
  function applyTheme(theme) {
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    if (themeBtn) themeBtn.textContent = labels[theme] || labels.auto;
  }
  let theme = localStorage.getItem('kolu-export-theme') || 'auto';
  if (theme !== 'light' && theme !== 'dark') theme = 'auto';
  applyTheme(theme);
  themeBtn?.addEventListener('click', () => {
    theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
    localStorage.setItem('kolu-export-theme', theme);
    applyTheme(theme);
  });
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
  const agentPill = `<span class="pill agent">${escapeHtml(AGENT_LABEL[transcript.agentKind])}</span>`;
  const modelPill = transcript.model
    ? `<span class="pill model"><code>${escapeHtml(transcript.model)}</code></span>`
    : "";
  const tokensPill =
    transcript.contextTokens !== null
      ? `<span class="pill tokens" title="Context tokens">${escapeHtml(formatTokens(transcript.contextTokens))} tokens</span>`
      : "";
  const prPill = transcript.pr
    ? `<a class="pill pr" href="${escapeHtml(transcript.pr.url)}" target="_blank" rel="noopener noreferrer">PR #${transcript.pr.number}</a>`
    : "";
  const cwdPill = transcript.cwd
    ? `<span class="pill cwd"><code>${escapeHtml(transcript.cwd)}</code></span>`
    : "";
  const countsPill = `<span class="pill">${counts.user} prompts · ${counts.assistant} replies · ${counts.toolCalls} tool calls</span>`;
  const exportedPill = `<span class="pill">Exported ${escapeHtml(formatTimestamp(transcript.exportedAt))}</span>`;
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
  <div class="controls">
    <label title="Hide tool calls and tool results"><input type="checkbox" data-toggle="tools" />Hide tools</label>
    <button type="button" data-toggle="theme" title="Cycle theme: auto → light → dark">Theme: auto</button>
    <button type="button" data-nav="prev" title="Previous prompt (k)">↑</button>
    <span class="pos"><span data-nav-pos>–</span> / <span data-nav-total>0</span></span>
    <button type="button" data-nav="next" title="Next prompt (j)">↓</button>
  </div>
  <div class="meta">
    ${agentPill}
    ${modelPill}
    ${tokensPill}
    ${prPill}
    ${cwdPill}
    ${countsPill}
    ${exportedPill}
  </div>
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
