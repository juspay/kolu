/** Render a `Transcript` to a self-contained HTML document.
 *
 *  Pure function: no I/O, no side effects, no Node-only APIs (so the
 *  same renderer could move to a shared package later if a CLI export
 *  path appears). Dispatches only on `event.kind` — never on
 *  `transcript.agentKind` — so a new vendor's tool name needs zero
 *  changes here. The agentKind is rendered as a header label.
 *
 *  Aesthetic: editorial transcript. Warm parchment palette, serif
 *  display, numbered prompt gutters, floating dock for the toggles +
 *  prompt navigation. Tool calls collapse by default (the dock toggle
 *  reveals them). All interactivity is inline JS; no external assets. */

import type { Transcript, TranscriptEvent } from "kolu-common";
import { match } from "ts-pattern";

const AGENT_LABEL: Record<Transcript["agentKind"], string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  codex: "Codex",
};

/** Inline SVGs for role badges. Styled with `currentColor` so they pick
 *  up the surrounding `--user`/`--assistant`/`--tool` accents. */
const USER_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21v-1a8 8 0 0 1 16 0v1"></path></svg>';
const ASSISTANT_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="2"></rect><path d="M12 7V3"></path><circle cx="12" cy="3" r="0.5" fill="currentColor"></circle><circle cx="9" cy="13" r="1" fill="currentColor"></circle><circle cx="15" cy="13" r="1" fill="currentColor"></circle><path d="M9 17h6"></path><path d="M2 13v2"></path><path d="M22 13v2"></path></svg>';
const REASONING_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6c0 2 1 3 1 5h10c0-2 1-3 1-5a6 6 0 0 0-6-6z"></path><path d="M9 19h6"></path><path d="M10 22h4"></path></svg>';
const TOOL_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5 2.5-2.5z"></path></svg>';
const TOOLS_DOCK_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v4"></path><path d="M12 18v4"></path><path d="M4.93 4.93l2.83 2.83"></path><path d="M16.24 16.24l2.83 2.83"></path><path d="M2 12h4"></path><path d="M18 12h4"></path><path d="M4.93 19.07l2.83-2.83"></path><path d="M16.24 7.76l2.83-2.83"></path></svg>';
const EDIT_DOCK_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';
const THEME_DOCK_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

/** Inline kolu logo — five rainbow tiered steps (கோலு). Pulled from
 *  packages/client/favicon.svg verbatim so the export carries the same
 *  brand mark the live app does. Inline keeps the document
 *  self-contained and offline-safe. */
const KOLU_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="18" height="18" aria-hidden="true"><rect x="1" y="26" width="30" height="5" rx="1.2" fill="#ef4444"/><rect x="4" y="20" width="25" height="5" rx="1.2" fill="#f59e0b"/><rect x="8" y="14" width="20" height="5" rx="1.2" fill="#22c55e"/><rect x="12" y="8" width="15" height="5" rx="1.2" fill="#3b82f6"/><rect x="16" y="2" width="10" height="5" rx="1.2" fill="#a855f7"/></svg>';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Apply inline markdown formatting (bold, italic, inline code, links)
 *  to a string that has already been HTML-escaped. Order matters:
 *  inline code first so its content isn't mangled by emphasis, links
 *  next so their text content can carry emphasis. */
function applyInline(s: string): string {
  return s
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(
      /\[([^\]\n]+)\]\(([^)\n\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

interface ListMarker {
  match: RegExp;
  tag: "ul" | "ol";
  cls: string;
}

/** Detect the start of a markdown list at this line. The capture group
 *  is the inline content after the marker, ready for `applyInline`. */
function detectListMarker(line: string): ListMarker | null {
  if (/^\s*[-*+]\s+/.test(line)) {
    return {
      match: /^\s*[-*+]\s+(.*)$/,
      tag: "ul",
      cls: "md-list",
    };
  }
  if (/^\s*\d+\.\s+/.test(line)) {
    return {
      match: /^\s*\d+\.\s+(.*)$/,
      tag: "ol",
      cls: "md-list md-list--ordered",
    };
  }
  return null;
}

/** Render the buffered content of a single list item. Blank entries in
 *  `buf` mark paragraph breaks within the item; one paragraph collapses
 *  to inline content (no wrapper), multiple paragraphs each get a
 *  `<p>`. */
function renderListItem(buf: string[]): string {
  const paras: string[][] = [[]];
  for (const ln of buf) {
    if (ln === "") paras.push([]);
    else (paras[paras.length - 1] ?? []).push(ln);
  }
  const nonEmpty = paras.filter((p) => p.length > 0);
  if (nonEmpty.length <= 1) {
    return applyInline((nonEmpty[0] ?? []).join(" "));
  }
  return nonEmpty.map((p) => `<p>${applyInline(p.join(" "))}</p>`).join("");
}

/** Render a markdown subset to HTML. Headings (h1–h3), fenced code,
 *  ordered/unordered lists, blockquotes, horizontal rules, and inline
 *  formatting. Operates on already-escaped text — `<` is `&lt;` and
 *  `>` is `&gt;`, so block detection looks for the escaped forms.
 *  Anything not matched falls through as plain paragraph text. */
export function renderMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  const lines = escaped.split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p>${applyInline(para.join(" "))}</p>`);
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Fenced code block — preserve content verbatim.
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const lang = fence[1] ?? "";
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      i++; // closing fence
      const langAttr = lang ? ` data-lang="${lang}"` : "";
      out.push(
        `<pre class="md-code"${langAttr}><code>${buf.join("\n")}</code></pre>`,
      );
      continue;
    }

    // Headings — level + 2 so a single `#` becomes h3 (h1/h2 are reserved
    // for the document chrome).
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara();
      const level = (heading[1] ?? "").length + 2;
      out.push(
        `<h${level} class="md-h">${applyInline(heading[2] ?? "")}</h${level}>`,
      );
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^-{3,}\s*$/.test(line) || /^\*{3,}\s*$/.test(line)) {
      flushPara();
      out.push(`<hr class="md-hr" />`);
      i++;
      continue;
    }

    // Blockquote — `>` was escaped to `&gt;`.
    if (line.startsWith("&gt; ") || line === "&gt;") {
      flushPara();
      const buf: string[] = [];
      while (
        i < lines.length &&
        ((lines[i] ?? "").startsWith("&gt; ") || lines[i] === "&gt;")
      ) {
        buf.push((lines[i] ?? "").replace(/^&gt;\s?/, ""));
        i++;
      }
      out.push(
        `<blockquote class="md-quote">${applyInline(buf.join(" "))}</blockquote>`,
      );
      continue;
    }

    // Bullet / ordered list. Each item absorbs subsequent indented
    // continuation lines (and blank lines between them) so multi-
    // paragraph items render as one cohesive `<li>` instead of breaking
    // into separate `<ul>` blocks at every blank line.
    {
      const bulletKind = detectListMarker(line);
      if (bulletKind) {
        flushPara();
        const items: string[] = [];
        while (i < lines.length) {
          const cur = lines[i] ?? "";
          const m = bulletKind.match.exec(cur);
          if (!m) break;
          const buf: string[] = [m[1] ?? ""];
          i++;
          // Pull in continuation lines: indented (≥1 space) lines, plus
          // blank lines whose next non-blank is also indented. Stops at
          // the next bullet marker or any non-indented non-blank line.
          while (i < lines.length) {
            const peek = lines[i] ?? "";
            if (detectListMarker(peek)) break;
            if (peek.trim() === "") {
              let j = i + 1;
              while (j < lines.length && (lines[j] ?? "").trim() === "") j++;
              if (j >= lines.length) break;
              const next = lines[j] ?? "";
              if (detectListMarker(next)) {
                // Blank lines between sibling bullets — skip past them
                // so the outer loop picks up the next bullet.
                i = j;
                break;
              }
              if (/^\s+\S/.test(next)) {
                buf.push("");
                i = j;
                continue;
              }
              break;
            }
            if (/^\s+\S/.test(peek)) {
              buf.push(peek.replace(/^\s+/, ""));
              i++;
              continue;
            }
            break;
          }
          items.push(`<li>${renderListItem(buf)}</li>`);
        }
        out.push(
          `<${bulletKind.tag} class="${bulletKind.cls}">${items.join("")}</${bulletKind.tag}>`,
        );
        continue;
      }
    }

    // Blank line breaks paragraphs.
    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }

    // Default — accumulate into the current paragraph.
    para.push(line);
    i++;
  }
  flushPara();
  return out.join("\n");
}

/** Tools whose payload is the agent's actual file change. These render
 *  inline as a diff (not collapsed under "Tools hidden") because the
 *  diff IS the conversation content — the agent's edits ARE the work
 *  being reviewed. Names cover Claude Code (Edit/MultiEdit/Write/
 *  NotebookEdit) and Codex (apply_patch). OpenCode emits its tools
 *  under different names not yet covered. */
const EDIT_TOOL_NAMES = new Set([
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "apply_patch",
]);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strField(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  return typeof v === "string" ? v : "";
}

/** Render an Edit-style diff (one old chunk → one new chunk) at line
 *  granularity. Strips common leading/trailing lines so the change is
 *  obvious; everything in between is rendered as `-` removed and `+`
 *  added. Naive but adequate for the small chunks Edit tools carry. */
function renderEditDiff(
  filePath: string,
  oldText: string,
  newText: string,
): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  let head = 0;
  while (
    head < oldLines.length &&
    head < newLines.length &&
    oldLines[head] === newLines[head]
  )
    head++;
  let tailOld = oldLines.length;
  let tailNew = newLines.length;
  while (
    tailOld > head &&
    tailNew > head &&
    oldLines[tailOld - 1] === newLines[tailNew - 1]
  ) {
    tailOld--;
    tailNew--;
  }
  const ctx: string[] = [];
  if (head > 0)
    ctx.push(
      `<span class="diff-line diff-ctx">  ${escapeHtml(oldLines[head - 1] ?? "")}</span>`,
    );
  for (let i = head; i < tailOld; i++) {
    ctx.push(
      `<span class="diff-line diff-del">- ${escapeHtml(oldLines[i] ?? "")}</span>`,
    );
  }
  for (let i = head; i < tailNew; i++) {
    ctx.push(
      `<span class="diff-line diff-add">+ ${escapeHtml(newLines[i] ?? "")}</span>`,
    );
  }
  if (tailOld < oldLines.length) {
    ctx.push(
      `<span class="diff-line diff-ctx">  ${escapeHtml(oldLines[tailOld] ?? "")}</span>`,
    );
  }
  // Concatenate without newlines: each span is `display:block`, so a
  // literal newline inside the surrounding `<pre>` would double-space
  // every row.
  return `<div class="diff"><div class="diff-file">${escapeHtml(filePath)}</div><pre class="diff-body">${ctx.join("")}</pre></div>`;
}

/** Render a Write tool call: a brand-new file with all content as
 *  added lines. */
function renderWriteDiff(filePath: string, content: string): string {
  const body = content
    .split("\n")
    .map((l) => `<span class="diff-line diff-add">+ ${escapeHtml(l)}</span>`)
    .join("");
  return `<div class="diff"><div class="diff-file">${escapeHtml(filePath)} <span class="diff-tag">new</span></div><pre class="diff-body">${body}</pre></div>`;
}

/** Render a Codex `apply_patch` payload (already in unified-diff-ish
 *  form) by line-coloring `+`/`-`/`***`. */
function renderApplyPatch(patch: string): string {
  const body = patch
    .split("\n")
    .map((l) => {
      const cls = l.startsWith("+")
        ? "diff-add"
        : l.startsWith("-")
          ? "diff-del"
          : l.startsWith("***") || l.startsWith("@@")
            ? "diff-hunk"
            : "diff-ctx";
      return `<span class="diff-line ${cls}">${escapeHtml(l)}</span>`;
    })
    .join("");
  return `<div class="diff"><pre class="diff-body">${body}</pre></div>`;
}

/** Dispatch on toolName for the well-known edit tools; fall through to
 *  pretty JSON for everything else. Operates on the IR's `unknown`
 *  inputs without leaking vendor specifics into the renderer's
 *  signature — the helper just probes structurally. */
function renderToolInputsHtml(toolName: string, inputs: unknown): string {
  if (toolName === "apply_patch" && typeof inputs === "string") {
    return renderApplyPatch(inputs);
  }
  if (isObj(inputs)) {
    if (toolName === "Edit") {
      return renderEditDiff(
        strField(inputs, "file_path"),
        strField(inputs, "old_string"),
        strField(inputs, "new_string"),
      );
    }
    if (toolName === "Write") {
      return renderWriteDiff(
        strField(inputs, "file_path"),
        strField(inputs, "content"),
      );
    }
    if (toolName === "NotebookEdit") {
      return renderEditDiff(
        strField(inputs, "notebook_path"),
        strField(inputs, "old_source"),
        strField(inputs, "new_source"),
      );
    }
    if (toolName === "MultiEdit") {
      const filePath = strField(inputs, "file_path");
      const edits = inputs.edits;
      if (Array.isArray(edits)) {
        return edits
          .map((e) =>
            isObj(e)
              ? renderEditDiff(
                  filePath,
                  strField(e, "old_string"),
                  strField(e, "new_string"),
                )
              : "",
          )
          .filter(Boolean)
          .join("");
      }
    }
  }
  return `<pre class="card-text card-text--code">${escapeHtml(prettyJson(inputs))}</pre>`;
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
  const tsHtml = ts ? `<time class="ts">${escapeHtml(ts)}</time>` : "";
  return match(event)
    .with({ kind: "user" }, (e) => {
      return `<section class="event event--user" data-role="user" data-prompt-index="${index}">
  <div class="gutter">
    <span class="gutter-icon" aria-label="User">${USER_ICON}</span>
    <span class="gutter-num"></span>
  </div>
  <div class="card">
    <header class="card-head">
      <span class="card-role">User</span>
      ${tsHtml}
    </header>
    <pre class="card-text card-text--user">${escapeHtml(e.text)}</pre>
  </div>
</section>`;
    })
    .with({ kind: "assistant" }, (e) => {
      const model = e.model
        ? `<span class="card-model">${escapeHtml(e.model)}</span>`
        : "";
      return `<section class="event event--assistant">
  <div class="gutter">
    <span class="gutter-icon" aria-label="Assistant">${ASSISTANT_ICON}</span>
  </div>
  <div class="card">
    <header class="card-head">
      <span class="card-role">Assistant</span>
      ${model}
      ${tsHtml}
    </header>
    <div class="card-text card-text--assistant md">${renderMarkdown(e.text)}</div>
  </div>
</section>`;
    })
    .with({ kind: "reasoning" }, (e) => {
      return `<section class="event event--reasoning">
  <div class="gutter">
    <span class="gutter-icon" aria-label="Reasoning">${REASONING_ICON}</span>
  </div>
  <div class="card">
    <details>
      <summary><span class="card-role">Reasoning</span>${tsHtml}</summary>
      <pre class="card-text">${escapeHtml(e.text)}</pre>
    </details>
  </div>
</section>`;
    })
    .with({ kind: "tool_call" }, (e) => {
      // Edit-class tools render inline as diffs and stay visible even
      // when the global "Hide tools" toggle is on — the diff IS the
      // conversation content, not an exec-output side-channel.
      if (EDIT_TOOL_NAMES.has(e.toolName)) {
        return `<section class="event event--edit" data-call-id="${escapeHtml(e.id ?? "")}">
  <div class="gutter">
    <span class="gutter-icon" aria-label="Edit">${TOOL_ICON}</span>
  </div>
  <div class="card">
    <header class="card-head">
      <span class="card-role">Edit</span>
      <span class="tool-name">${escapeHtml(e.toolName)}</span>
      ${tsHtml}
    </header>
    ${renderToolInputsHtml(e.toolName, e.inputs)}
  </div>
</section>`;
      }
      const inputs = prettyJson(e.inputs);
      return `<section class="event event--tool event--tool-call" data-call-id="${escapeHtml(e.id ?? "")}">
  <div class="gutter">
    <span class="gutter-icon" aria-label="Tool call">${TOOL_ICON}</span>
  </div>
  <div class="card">
    <details>
      <summary>
        <span class="card-role">Tool call</span>
        <span class="tool-name">${escapeHtml(e.toolName)}</span>
        ${tsHtml}
      </summary>
      <pre class="card-text card-text--code">${escapeHtml(inputs)}</pre>
    </details>
  </div>
</section>`;
    })
    .with({ kind: "tool_result" }, (e) => {
      const output = prettyJson(e.output);
      const errCls = e.isError ? " event--error" : "";
      const errLabel = e.isError ? " (error)" : "";
      return `<section class="event event--tool event--tool-result${errCls}" data-call-id="${escapeHtml(e.id ?? "")}">
  <div class="gutter">
    <span class="gutter-icon" aria-label="Tool result">${TOOL_ICON}</span>
  </div>
  <div class="card">
    <details>
      <summary>
        <span class="card-role">Tool result${errLabel}</span>
        ${tsHtml}
      </summary>
      <pre class="card-text card-text--code">${escapeHtml(output)}</pre>
    </details>
  </div>
</section>`;
    })
    .exhaustive();
}

/** Tally event counts for the masthead summary line. */
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
 *  overrides it for a manual choice. The palette is "warm parchment":
 *  cream paper + ink in light, deep umber + parchment in dark, with a
 *  rust/amber accent and four role colors that read as a coherent
 *  family rather than seven primaries.  */
const STYLE = `
  :root {
    --bg: #0F0E0B;
    --bg-elev: #16140F;
    --bg-sunk: #0A0907;
    --rule: #2A2620;
    --rule-strong: #3A3429;
    --ink: #E8DEC8;
    --ink-2: #B0A48A;
    --ink-3: #75694E;
    --accent: #D4823A;
    --user: #7FCC8A;
    --assistant: #88AED8;
    --reasoning: #8895A4;
    --tool: #C4A046;
    --error: #DC6260;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #FBF7EE;
      --bg-elev: #F2EBD9;
      --bg-sunk: #F6F0E0;
      --rule: #D2C7AE;
      --rule-strong: #B4A88A;
      --ink: #1B1611;
      --ink-2: #4A4234;
      --ink-3: #87796A;
      --accent: #B5400F;
      --user: #2F7A3A;
      --assistant: #2D5F8A;
      --reasoning: #5B6A78;
      --tool: #8E6418;
      --error: #9B2828;
    }
  }
  :root[data-theme="dark"] {
    --bg: #0F0E0B;
    --bg-elev: #16140F;
    --bg-sunk: #0A0907;
    --rule: #2A2620;
    --rule-strong: #3A3429;
    --ink: #E8DEC8;
    --ink-2: #B0A48A;
    --ink-3: #75694E;
    --accent: #D4823A;
    --user: #7FCC8A;
    --assistant: #88AED8;
    --reasoning: #8895A4;
    --tool: #C4A046;
    --error: #DC6260;
  }
  :root[data-theme="light"] {
    --bg: #FBF7EE;
    --bg-elev: #F2EBD9;
    --bg-sunk: #F6F0E0;
    --rule: #D2C7AE;
    --rule-strong: #B4A88A;
    --ink: #1B1611;
    --ink-2: #4A4234;
    --ink-3: #87796A;
    --accent: #B5400F;
    --user: #2F7A3A;
    --assistant: #2D5F8A;
    --reasoning: #5B6A78;
    --tool: #8E6418;
    --error: #9B2828;
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--ink);
    font-family: ui-serif, "Iowan Old Style", "Charter", "Cambria", Georgia, serif;
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    counter-reset: prompt;
  }
  ::selection { background: var(--accent); color: var(--bg); }
  a { color: var(--accent); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
  a:hover { text-decoration-thickness: 2px; }

  /* --- Document --- */
  .doc {
    max-width: 48rem;
    margin: 0 auto;
    padding: 2.5rem 1.25rem 8rem 1.25rem;
  }
  @media (min-width: 768px) {
    .doc { padding: 3rem 1.5rem 8rem 3rem; }
  }

  /* --- Masthead --- */
  .masthead { margin-bottom: 2rem; position: relative; }
  .brand {
    position: absolute;
    top: 0;
    right: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.5rem 0.25rem 0.375rem;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--ink-3);
    text-decoration: none;
    border: 1px solid var(--rule);
    border-radius: 4px;
    background: var(--bg-elev);
    transition: color 0.12s ease, border-color 0.12s ease;
  }
  .brand:hover { color: var(--ink); border-color: var(--rule-strong); }
  .brand .brand-mark { display: inline-flex; }
  .brand .brand-name { font-weight: 600; }

  /* --- Footer colophon --- */
  .colophon {
    margin-top: 4rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--rule);
    display: flex;
    align-items: center;
    gap: 0.625rem;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 0.75rem;
    color: var(--ink-3);
  }
  .colophon a { color: var(--accent); text-decoration: none; border-bottom: 1px dotted currentColor; }
  .colophon a:hover { color: var(--user); }
  .colophon-mark { display: inline-flex; flex-shrink: 0; }
  .eyebrow {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--ink-3);
    margin-bottom: 1.25rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.625rem;
    align-items: center;
  }
  .eyebrow .sep { color: var(--rule-strong); }
  .eyebrow .repo { color: var(--accent); font-weight: 600; letter-spacing: 0.12em; }
  .eyebrow .pr { color: var(--user); text-decoration: none; border-bottom: 1px dotted currentColor; }
  .eyebrow .pr:hover { color: var(--accent); }
  .title {
    font-family: ui-serif, "Iowan Old Style", "Charter", "Cambria", Georgia, serif;
    font-size: clamp(1.875rem, 4vw, 2.625rem);
    font-weight: 600;
    line-height: 1.15;
    letter-spacing: -0.02em;
    margin: 0 0 1.5rem 0;
    color: var(--ink);
  }
  .byline {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 0.8125rem;
    color: var(--ink-2);
    line-height: 1.65;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.625rem;
    align-items: center;
  }
  .byline .sep { color: var(--rule-strong); margin: 0 0.125rem; }
  .byline .key { color: var(--ink-3); }
  .byline code { font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace; font-size: 0.78125rem; color: var(--ink-2); }
  /* Runtime stamp: agent · model · tokens grouped in a single subtle
     pill so the "who/what is talking" trio reads as one beat. */
  .byline-runtime {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.125rem 0.5rem;
    background: var(--bg-elev);
    border: 1px solid var(--rule);
    border-radius: 4px;
    font-size: 0.75rem;
  }
  .byline-runtime .byline-rt-sep { color: var(--rule-strong); }
  .byline-runtime .byline-agent { color: var(--accent); font-weight: 600; letter-spacing: 0.02em; }
  .byline-runtime .byline-model { font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace; font-size: 0.71875rem; color: var(--ink); background: none; border: none; padding: 0; }
  .byline-runtime .byline-tokens { color: var(--ink-2); font-variant-numeric: tabular-nums; }
  .rule {
    border: none;
    border-top: 2px solid var(--ink);
    border-bottom: 1px solid var(--ink);
    height: 4px;
    background: transparent;
    margin: 1.5rem 0 0 0;
  }

  /* --- Events --- */
  .events {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .event {
    display: grid;
    grid-template-columns: 2.25rem 1fr;
    gap: 0.625rem;
    position: relative;
  }
  @media (min-width: 768px) {
    .event { grid-template-columns: 2.75rem 1fr; gap: 0.875rem; }
  }
  .gutter {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    padding-top: 0.125rem;
    color: var(--ink-3);
    user-select: none;
  }
  .gutter-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 999px;
    border: 1px solid var(--rule);
    background: var(--bg-elev);
  }
  .gutter-num {
    font-family: ui-serif, Georgia, serif;
    font-size: 0.875rem;
    color: var(--ink-3);
    margin-top: 0.5rem;
    font-feature-settings: "lnum", "tnum";
    letter-spacing: 0.05em;
  }
  .card {
    min-width: 0;
    padding-top: 0.125rem;
  }
  .card-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
    flex-wrap: wrap;
  }
  .card-role {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-weight: 600;
    color: var(--ink-2);
  }
  .card-model {
    font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
    font-size: 0.6875rem;
    color: var(--ink-3);
  }
  .ts {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 0.6875rem;
    color: var(--ink-3);
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  /* User events: tinted pulled-quote on rust accent. The wash bonds the
     card to its gutter color so a User turn reads as "human input zone"
     at a glance, contrasting strongly with the clean Assistant card. */
  .event--user .gutter-icon { color: var(--user); border-color: var(--user); }
  .event--user .gutter-num::before {
    counter-increment: prompt;
    content: counter(prompt, decimal-leading-zero);
  }
  .event--user .card {
    border-left: 3px solid var(--user);
    padding: 0.5rem 0.75rem 0.5rem 0.875rem;
    margin-left: -1px;
    background: color-mix(in srgb, var(--user) 7%, transparent);
    border-radius: 0 4px 4px 0;
  }
  .event--user .card-text--user {
    font-family: ui-serif, "Iowan Old Style", "Charter", "Cambria", Georgia, serif;
    font-size: 1rem;
    line-height: 1.5;
    font-weight: 500;
    color: var(--ink);
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    background: none;
    border: none;
    padding: 0;
  }
  .event--user.is-current .card {
    background: color-mix(in srgb, var(--user) 14%, transparent);
    border-left-width: 4px;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--user) 30%, transparent);
  }
  .event--user.is-current .gutter-num { color: var(--user); }

  /* Assistant events: sans-serif working-notes voice, sage accent. The
     font shift from serif (User) to sans (Assistant) is the dominant
     human-vs-machine visual rhythm. */
  .event--assistant .gutter-icon { color: var(--assistant); border-color: var(--assistant); }
  .card-text--assistant {
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: var(--ink);
  }

  /* Markdown elements inside assistant text — tighter rhythm so multi-
     paragraph technical responses read as one unit, not as separate
     beats. */
  .md > :first-child { margin-top: 0; }
  .md p { margin: 0 0 0.5rem 0; }
  .md p:last-child { margin-bottom: 0; }
  .md strong { font-weight: 700; }
  .md em { font-style: italic; }
  .md code {
    font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
    font-size: 0.85em;
    background: var(--bg-elev);
    border: 1px solid var(--rule);
    border-radius: 3px;
    padding: 0.0625rem 0.25rem;
    color: var(--ink);
  }
  .md a { color: var(--accent); }
  .md .md-h {
    font-family: ui-serif, Georgia, serif;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--ink);
    margin: 0.875rem 0 0.25rem 0;
  }
  .md h3.md-h { font-size: 1.0625rem; }
  .md h4.md-h { font-size: 1rem; }
  .md h5.md-h { font-size: 0.9375rem; color: var(--ink-2); }
  .md .md-list { margin: 0 0 0.5rem 0; padding-left: 1.25rem; }
  .md .md-list li { margin: 0.125rem 0; line-height: 1.5; }
  .md .md-list li > p { margin: 0 0 0.25rem 0; }
  .md .md-list li > p:last-child { margin-bottom: 0; }
  .md .md-list--ordered li::marker { color: var(--ink-3); font-feature-settings: "lnum", "tnum"; }
  .md .md-quote {
    margin: 0 0 0.5rem 0;
    padding: 0.125rem 0 0.125rem 0.75rem;
    border-left: 3px solid var(--rule-strong);
    color: var(--ink-2);
    font-style: italic;
  }
  .md .md-hr {
    border: none;
    border-top: 1px solid var(--rule);
    margin: 1rem 0;
  }
  .md .md-code {
    font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
    font-size: 0.78125rem;
    line-height: 1.45;
    background: var(--bg-sunk);
    border: 1px solid var(--rule);
    border-radius: 5px;
    padding: 0.5rem 0.625rem;
    margin: 0 0 0.5rem 0;
    color: var(--ink);
    overflow-x: auto;
    white-space: pre;
  }
  .md .md-code code { background: none; border: none; padding: 0; font-size: inherit; }

  /* Reasoning: muted, collapsed by default. */
  .event--reasoning { opacity: 0.85; }
  .event--reasoning .gutter-icon { color: var(--reasoning); border-color: var(--reasoning); }
  .event--reasoning .card details summary .card-role { color: var(--reasoning); }
  .event--reasoning .card-text {
    font-family: ui-serif, Georgia, serif;
    font-size: 0.9375rem;
    color: var(--ink-2);
    background: var(--bg-elev);
    border: 1px solid var(--rule);
    border-radius: 4px;
    padding: 0.625rem 0.75rem;
    margin: 0.5rem 0 0 0;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.55;
    font-style: italic;
  }

  /* Edit events: agent file changes, visible by default with a real
     diff view. The dock toggle can hide them. Distinct from tool calls
     (which stay hidden by their own toggle). */
  body[data-hide-edits="true"] .event--edit { display: none; }
  .event--edit .gutter-icon { color: var(--accent); border-color: var(--accent); }
  .event--edit .card-role { color: var(--accent); letter-spacing: 0.16em; }
  .event--edit .tool-name { font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace; font-size: 0.71875rem; color: var(--ink-3); }
  .diff {
    margin-top: 0.25rem;
    border: 1px solid var(--rule);
    border-radius: 5px;
    overflow: hidden;
    background: var(--bg-sunk);
  }
  .diff + .diff { margin-top: 0.5rem; }
  .diff-file {
    font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
    font-size: 0.75rem;
    color: var(--ink-2);
    background: var(--bg-elev);
    border-bottom: 1px solid var(--rule);
    padding: 0.25rem 0.625rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .diff-tag {
    font-family: ui-sans-serif, system-ui, sans-serif;
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 3px;
    padding: 0 0.3125rem;
  }
  .diff-body {
    margin: 0;
    padding: 0.375rem 0;
    font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--ink);
    overflow-x: auto;
    white-space: pre;
  }
  .diff-line {
    display: block;
    padding: 0 0.625rem;
  }
  .diff-line.diff-add {
    color: var(--assistant);
    background: color-mix(in srgb, var(--assistant) 10%, transparent);
  }
  .diff-line.diff-del {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 10%, transparent);
  }
  .diff-line.diff-ctx { color: var(--ink-3); }
  .diff-line.diff-hunk { color: var(--reasoning); font-weight: 600; }

  /* Tool events: bronze accent, hidden by default. */
  body[data-hide-tools="true"] .event--tool { display: none; }
  .event--tool .gutter-icon { color: var(--tool); border-color: var(--tool); }
  .event--tool details summary .card-role { color: var(--tool); }
  .event--tool .tool-name {
    font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
    font-size: 0.75rem;
    color: var(--tool);
  }
  .event--tool.event--error .gutter-icon { color: var(--error); border-color: var(--error); }
  .event--tool.event--error details summary .card-role { color: var(--error); }
  .event--tool .card-text--code {
    font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
    font-size: 0.78125rem;
    line-height: 1.5;
    background: var(--bg-sunk);
    border: 1px solid var(--rule);
    border-radius: 4px;
    padding: 0.625rem 0.75rem;
    margin: 0.5rem 0 0 0;
    color: var(--ink-2);
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
  }

  /* Generic plain pre (used for user / reasoning) */
  .card-text { white-space: pre-wrap; word-break: break-word; }

  /* Details/summary chrome */
  details summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.25rem 0;
  }
  details summary::-webkit-details-marker { display: none; }
  details summary::before {
    content: "›";
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    color: var(--ink-3);
    font-size: 0.875rem;
    transition: transform 0.12s ease;
    display: inline-block;
    margin-right: 0.125rem;
  }
  details[open] summary::before { transform: rotate(90deg); color: var(--ink-2); }

  .empty {
    color: var(--ink-3);
    text-align: center;
    padding: 4rem 1rem;
    font-style: italic;
    font-family: ui-serif, Georgia, serif;
  }

  /* --- Floating dock (bottom-right, always visible) --- */
  .dock {
    position: fixed;
    right: 1.25rem;
    bottom: 1.25rem;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    padding: 0.5rem;
    background: color-mix(in srgb, var(--bg-elev) 92%, transparent);
    backdrop-filter: blur(12px) saturate(140%);
    -webkit-backdrop-filter: blur(12px) saturate(140%);
    border: 1px solid var(--rule);
    border-radius: 12px;
    box-shadow: 0 1px 0 rgba(0,0,0,0.04), 0 12px 32px -8px rgba(0,0,0,0.25);
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 0.75rem;
    min-width: 12.5rem;
    color: var(--ink);
  }
  .dock-btn {
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 0.5rem 0.625rem;
    color: var(--ink);
    font: inherit;
    cursor: pointer;
    display: grid;
    grid-template-columns: 1rem 1fr auto;
    align-items: center;
    gap: 0.5rem;
    text-align: left;
    width: 100%;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  .dock-btn:hover { background: var(--bg-sunk); border-color: var(--rule); }
  .dock-btn .dock-icon { color: var(--ink-3); display: inline-flex; }
  .dock-btn:hover .dock-icon { color: var(--accent); }
  .dock-btn .dock-label {
    font-weight: 600;
    letter-spacing: 0.04em;
    font-size: 0.6875rem;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  .dock-btn .dock-state {
    font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
    font-size: 0.6875rem;
    color: var(--ink);
    padding: 0.125rem 0.375rem;
    background: var(--bg-sunk);
    border: 1px solid var(--rule);
    border-radius: 4px;
    min-width: 3rem;
    text-align: center;
  }
  .dock-btn[aria-pressed="true"] .dock-state { color: var(--accent); border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .dock-btn[data-toggle="theme"] .dock-state { color: var(--ink); }

  .dock-divider { height: 1px; background: var(--rule); margin: 0.125rem 0.375rem; }
  .dock-nav {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem;
  }
  .dock-nav button {
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    border: 1px solid var(--rule);
    border-radius: 6px;
    color: var(--ink-2);
    font: inherit;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    width: 1.875rem;
    height: 1.875rem;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color 0.12s ease, border-color 0.12s ease;
  }
  .dock-nav button:hover { color: var(--accent); border-color: var(--accent); }
  .dock-pos {
    text-align: center;
    font-family: ui-serif, Georgia, serif;
    font-size: 0.8125rem;
    color: var(--ink-2);
    font-feature-settings: "lnum", "tnum";
    letter-spacing: 0.05em;
  }
  .dock-pos [data-nav-pos] { color: var(--accent); font-weight: 600; }

  .hint {
    margin: 1.5rem 0 0 0;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 0.75rem;
    color: var(--ink-3);
    text-align: center;
  }
  .hint kbd {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.6875rem;
    background: var(--bg-elev);
    border: 1px solid var(--rule);
    border-bottom-width: 2px;
    border-radius: 3px;
    padding: 0.0625rem 0.25rem;
    color: var(--ink-2);
  }

  @media print {
    .dock, .hint { display: none !important; }
    body { background: white; color: black; }
  }
`;

/** Inline JS for prev/next-prompt navigation, the hide-tool-calls
 *  toggle (default ON), and theme cycling (auto → light → dark → auto).
 *  Toggle state persists in `localStorage`. Pure DOM, no deps. */
const SCRIPT = `
(function () {
  // --- Prompt navigation ---
  const prompts = Array.from(document.querySelectorAll('section.event--user[data-role="user"]'));
  const total = prompts.length;
  const posEl = document.querySelector('[data-nav-pos]');
  const totalEl = document.querySelector('[data-nav-total]');
  if (totalEl) totalEl.textContent = String(total);
  let cur = -1;

  function highlight(idx) {
    prompts.forEach((p, i) => p.classList.toggle('is-current', i === idx));
    if (posEl) posEl.textContent = idx >= 0 ? String(idx + 1).padStart(2, '0') : '–';
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

  // --- Hide tool calls toggle (default: hidden) ---
  const toolBtn = document.querySelector('[data-toggle="tools"]');
  function applyTools(hide) {
    document.body.dataset.hideTools = String(hide);
    if (toolBtn) {
      toolBtn.setAttribute('aria-pressed', String(hide));
      const stateEl = toolBtn.querySelector('[data-state]');
      if (stateEl) stateEl.textContent = hide ? 'hidden' : 'shown';
    }
  }
  const storedHideTools = localStorage.getItem('kolu-export-hide-tools');
  applyTools(storedHideTools !== '0');
  toolBtn?.addEventListener('click', () => {
    const nextHide = document.body.dataset.hideTools !== 'true';
    localStorage.setItem('kolu-export-hide-tools', nextHide ? '1' : '0');
    applyTools(nextHide);
  });

  // --- Hide edit calls toggle (default: shown) ---
  const editBtn = document.querySelector('[data-toggle="edits"]');
  function applyEdits(hide) {
    document.body.dataset.hideEdits = String(hide);
    if (editBtn) {
      editBtn.setAttribute('aria-pressed', String(hide));
      const stateEl = editBtn.querySelector('[data-state]');
      if (stateEl) stateEl.textContent = hide ? 'hidden' : 'shown';
    }
  }
  const storedHideEdits = localStorage.getItem('kolu-export-hide-edits');
  applyEdits(storedHideEdits === '1');
  editBtn?.addEventListener('click', () => {
    const nextHide = document.body.dataset.hideEdits !== 'true';
    localStorage.setItem('kolu-export-hide-edits', nextHide ? '1' : '0');
    applyEdits(nextHide);
  });

  // --- Theme cycle (auto → light → dark → auto) ---
  const themeBtn = document.querySelector('[data-toggle="theme"]');
  function applyTheme(theme) {
    if (theme === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    if (themeBtn) {
      const stateEl = themeBtn.querySelector('[data-state]');
      if (stateEl) stateEl.textContent = theme;
    }
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

/** Eyebrow above the title — answers "what repo and PR am I looking at?"
 *  before the document name. Repo name comes first as the most
 *  identifying piece of context; PR (when present) anchors the work to
 *  a code-review thread. Date and session id round it out. */
function renderEyebrow(transcript: Transcript): string {
  const exportedDate = (() => {
    try {
      return new Date(transcript.exportedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  })();
  const parts: string[] = [];
  if (transcript.repoName) {
    parts.push(`<span class="repo">${escapeHtml(transcript.repoName)}</span>`);
  }
  if (transcript.pr) {
    parts.push(
      `<a class="pr" href="${escapeHtml(transcript.pr.url)}" target="_blank" rel="noopener noreferrer">PR #${transcript.pr.number}</a>`,
    );
  }
  if (exportedDate) {
    parts.push(`<span>${escapeHtml(exportedDate)}</span>`);
  }
  parts.push(`<span>#${escapeHtml(transcript.sessionId.slice(0, 8))}</span>`);
  return `<div class="eyebrow">${parts.join('<span class="sep">·</span>')}</div>`;
}

/** Byline beneath the title — agent + model + tokens form a single
 *  visually grouped "runtime stamp" (these three identify the
 *  conversation's actor). Cwd, event counts, and exported timestamp
 *  follow as separate beats. */
function renderByline(
  transcript: Transcript,
  counts: { user: number; assistant: number; toolCalls: number },
): string {
  const runtime: string[] = [
    `<span class="byline-agent">${escapeHtml(AGENT_LABEL[transcript.agentKind])}</span>`,
  ];
  if (transcript.model) {
    runtime.push(
      `<span class="byline-rt-sep">·</span>`,
      `<code class="byline-model">${escapeHtml(transcript.model)}</code>`,
    );
  }
  if (transcript.contextTokens !== null) {
    runtime.push(
      `<span class="byline-rt-sep">·</span>`,
      `<span class="byline-tokens">${escapeHtml(formatTokens(transcript.contextTokens))} tokens</span>`,
    );
  }
  const parts: string[] = [
    `<span class="byline-runtime">${runtime.join("")}</span>`,
  ];
  if (transcript.cwd) {
    parts.push(
      `<span><span class="key">Cwd</span> <code>${escapeHtml(transcript.cwd)}</code></span>`,
    );
  }
  parts.push(
    `<span>${counts.user} prompts · ${counts.assistant} replies · ${counts.toolCalls} tools</span>`,
  );
  return parts.join('<span class="sep">·</span>');
}

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
  const eyebrow = renderEyebrow(transcript);
  const byline = renderByline(transcript, counts);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(titleText)} — kolu</title>
<style>${STYLE}</style>
</head>
<body data-hide-tools="true" data-hide-edits="false">
<article class="doc">
  <header class="masthead">
    <a class="brand" href="https://kolu.dev/" target="_blank" rel="noopener noreferrer" title="Exported by Kolu — kolu.dev">
      <span class="brand-mark">${KOLU_LOGO}</span>
      <span class="brand-name">kolu</span>
    </a>
    ${eyebrow}
    <h1 class="title">${escapeHtml(titleText)}</h1>
    <div class="byline">${byline}</div>
    <hr class="rule" />
  </header>
  <main class="events">
${eventsHtml}
  </main>
  <footer class="colophon">
    <span class="colophon-mark">${KOLU_LOGO}</span>
    <span>
      Exported by <a href="https://kolu.dev/" target="_blank" rel="noopener noreferrer">Kolu</a> —
      a workspace for orchestrating AI coding agents.
    </span>
  </footer>
  <p class="hint">Use <kbd>j</kbd>/<kbd>k</kbd> to move between prompts. The dock at lower-right toggles tools, edits, and theme.</p>
</article>
<aside class="dock" role="toolbar" aria-label="Document controls">
  <button type="button" class="dock-btn" data-toggle="edits" aria-pressed="false" title="Show or hide agent edits (file diffs)">
    <span class="dock-icon">${EDIT_DOCK_ICON}</span>
    <span class="dock-label">Edits</span>
    <span class="dock-state" data-state>shown</span>
  </button>
  <button type="button" class="dock-btn" data-toggle="tools" aria-pressed="true" title="Show or hide tool calls">
    <span class="dock-icon">${TOOLS_DOCK_ICON}</span>
    <span class="dock-label">Tools</span>
    <span class="dock-state" data-state>hidden</span>
  </button>
  <button type="button" class="dock-btn" data-toggle="theme" title="Cycle theme: auto → light → dark">
    <span class="dock-icon">${THEME_DOCK_ICON}</span>
    <span class="dock-label">Theme</span>
    <span class="dock-state" data-state>auto</span>
  </button>
  <div class="dock-divider"></div>
  <div class="dock-nav">
    <button type="button" data-nav="prev" title="Previous prompt (k)" aria-label="Previous prompt">↑</button>
    <span class="dock-pos"><span data-nav-pos>–</span> / <span data-nav-total>0</span></span>
    <button type="button" data-nav="next" title="Next prompt (j)" aria-label="Next prompt">↓</button>
  </div>
</aside>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
