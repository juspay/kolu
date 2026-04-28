/** @jsxRuntime automatic */
/** @jsxImportSource preact */
/** Preact components for the static transcript export.
 *
 *  Rendered once via `renderToString` from `preact-render-to-string`
 *  in `index.tsx`. Components are pure markup — every async chunk
 *  (markdown via `marked`, code surfaces via `@pierre/diffs/ssr`) is
 *  pre-resolved by the orchestrator and handed in as a string, which
 *  we splat through Preact's `dangerouslySetInnerHTML`.
 *
 *  No reactivity, no lifecycle. Each component runs once during SSR
 *  and emits HTML; runtime interactivity in the exported document
 *  comes from `script.js`, which queries the rendered DOM and wires
 *  up handlers. Preact (rather than SolidJS like the live client) is
 *  used here because it works with `tsx` + esbuild's automatic JSX
 *  runtime out of the box — no babel build step required. */

import type {
  ToolInput,
  Transcript,
  TranscriptEvent,
} from "kolu-transcript-core";
import type { JSX } from "preact";

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

const KOLU_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="18" height="18" aria-hidden="true"><rect x="1" y="26" width="30" height="5" rx="1.2" fill="#ef4444"/><rect x="4" y="20" width="25" height="5" rx="1.2" fill="#f59e0b"/><rect x="8" y="14" width="20" height="5" rx="1.2" fill="#22c55e"/><rect x="12" y="8" width="15" height="5" rx="1.2" fill="#3b82f6"/><rect x="16" y="2" width="10" height="5" rx="1.2" fill="#a855f7"/></svg>';

function compactText(s: string, max: number): string {
  const collapsed = s.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

function shortenPath(p: string): string {
  if (p.startsWith("./") || p.startsWith("../") || !p.includes("/")) return p;
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join("/")}`;
}

function toolSummary(input: ToolInput): string | null {
  switch (input.kind) {
    case "edit":
    case "write":
    case "read":
      return shortenPath(input.filePath);
    case "patch": {
      const firstLine = input.text.split("\n").find((l) => l.trim().length > 0);
      return firstLine ? compactText(firstLine, 80) : null;
    }
    case "bash":
      return input.command ? compactText(input.command, 80) : null;
    case "glob":
    case "grep":
      return input.path
        ? `${input.pattern} in ${shortenPath(input.path)}`
        : input.pattern || null;
    case "fetch":
      return input.url || null;
    case "opaque":
      return null;
  }
}

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

/** Edit-class kinds (edit | write | patch) render inline as Pierre
 *  diffs and stay visible even when "Hide tools" is on — the diff IS
 *  the conversation content, not an exec-output side-channel. */
export function isEditClass(input: ToolInput): boolean {
  return (
    input.kind === "edit" || input.kind === "write" || input.kind === "patch"
  );
}

/** Inline-style hook the CSS reads (`.event[style*="--subtask-depth"]`)
 *  for nested-subtask indentation. Set only when depth > 0 so depth-0
 *  markup stays clean. CSS custom properties keep their literal name
 *  (Preact doesn't camelCase keys that start with `--`). */
function depthStyle(depth: number): JSX.CSSProperties | undefined {
  return depth > 0
    ? ({ "--subtask-depth": String(depth) } as JSX.CSSProperties)
    : undefined;
}

/** Splat pre-rendered HTML into a wrapping `<div>`. The wrapper is
 *  inert (no class) so it doesn't disturb the parchment layout —
 *  Preact's SSR requires `dangerouslySetInnerHTML` to land on a real
 *  element rather than a fragment. */
const Html = (props: { html: string }) => (
  // biome-ignore lint/security/noDangerouslySetInnerHtml: pre-rendered by marked / Pierre, both escape input themselves.
  <div dangerouslySetInnerHTML={{ __html: props.html }} />
);

const Icon = (props: { svg: string; class?: string; label?: string }) => (
  <span
    class={props.class}
    aria-label={props.label}
    // biome-ignore lint/security/noDangerouslySetInnerHtml: SVGs are constants in this file.
    dangerouslySetInnerHTML={{ __html: props.svg }}
  />
);

/** A pre-resolved event ready to be turned into JSX. Async pieces
 *  (markdown via marked, code surfaces via Pierre) are computed by
 *  the orchestrator and handed in as strings to splat through
 *  `dangerouslySetInnerHTML`. */
export type RenderedEvent = {
  event: TranscriptEvent;
  index: number;
  depth: number;
  /** Pre-rendered HTML for the event body, when applicable:
   *  - user → escaped text in a `<pre>` (optionally collapsible)
   *  - assistant / reasoning → marked output
   *  - tool_call (edit-class) → concatenated Pierre chunks */
  bodyHtml?: string;
};

const Ts = (props: { ts: number | null }) => {
  const t = formatTimestamp(props.ts);
  return t ? <time class="ts">{t}</time> : null;
};

const UserEvent = (props: {
  event: Extract<TranscriptEvent, { kind: "user" }>;
  index: number;
  depth: number;
  bodyHtml: string;
}) => (
  <section
    class="event event--user"
    data-role="user"
    data-prompt-index={String(props.index)}
    style={depthStyle(props.depth)}
  >
    <div class="gutter">
      <Icon class="gutter-icon" label="User" svg={USER_ICON} />
      <span class="gutter-num" />
    </div>
    <div class="card">
      <header class="card-head">
        <span class="card-role">User</span>
        <Ts ts={props.event.ts} />
      </header>
      <Html html={props.bodyHtml} />
    </div>
  </section>
);

const AssistantEvent = (props: {
  event: Extract<TranscriptEvent, { kind: "assistant" }>;
  depth: number;
  bodyHtml: string;
}) => (
  <section class="event event--assistant" style={depthStyle(props.depth)}>
    <div class="gutter">
      <Icon class="gutter-icon" label="Assistant" svg={ASSISTANT_ICON} />
    </div>
    <div class="card">
      <header class="card-head">
        <span class="card-role">Assistant</span>
        {props.event.model && (
          <span class="card-model">{props.event.model}</span>
        )}
        <Ts ts={props.event.ts} />
      </header>
      <Html html={props.bodyHtml} />
    </div>
  </section>
);

const ReasoningEvent = (props: {
  event: Extract<TranscriptEvent, { kind: "reasoning" }>;
  depth: number;
  bodyHtml: string;
}) => (
  <section class="event event--reasoning" style={depthStyle(props.depth)}>
    <div class="gutter">
      <Icon class="gutter-icon" label="Reasoning" svg={REASONING_ICON} />
    </div>
    <div class="card">
      <details>
        <summary>
          <span class="card-role">Reasoning</span>
          <Ts ts={props.event.ts} />
        </summary>
        <Html html={props.bodyHtml} />
      </details>
    </div>
  </section>
);

const EditEvent = (props: {
  event: Extract<TranscriptEvent, { kind: "tool_call" }>;
  depth: number;
  bodyHtml: string;
}) => (
  <section
    class="event event--edit"
    data-call-id={props.event.id ?? ""}
    style={depthStyle(props.depth)}
  >
    <div class="gutter">
      <Icon class="gutter-icon" label="Edit" svg={TOOL_ICON} />
    </div>
    <div class="card">
      <header class="card-head">
        <span class="card-role">Edit</span>
        <span class="tool-name">{props.event.toolName}</span>
        <Ts ts={props.event.ts} />
      </header>
      <Html html={props.bodyHtml} />
    </div>
  </section>
);

const ToolCallEvent = (props: {
  event: Extract<TranscriptEvent, { kind: "tool_call" }>;
  depth: number;
}) => {
  const summary = toolSummary(props.event.inputs);
  return (
    <section
      class="event event--tool event--tool-call"
      data-call-id={props.event.id ?? ""}
      style={depthStyle(props.depth)}
    >
      <div class="gutter">
        <Icon class="gutter-icon" label="Tool call" svg={TOOL_ICON} />
      </div>
      <div class="card">
        <details>
          <summary>
            <span class="card-role">Tool call</span>
            <span class="tool-name">{props.event.toolName}</span>
            {summary && <span class="tool-summary">{summary}</span>}
            <Ts ts={props.event.ts} />
          </summary>
          <pre class="card-text card-text--code">
            {prettyJson(props.event.inputs)}
          </pre>
        </details>
      </div>
    </section>
  );
};

const ToolResultEvent = (props: {
  event: Extract<TranscriptEvent, { kind: "tool_result" }>;
  depth: number;
}) => (
  <section
    class={`event event--tool event--tool-result${props.event.isError ? " event--error" : ""}`}
    data-call-id={props.event.id ?? ""}
    style={depthStyle(props.depth)}
  >
    <div class="gutter">
      <Icon class="gutter-icon" label="Tool result" svg={TOOL_ICON} />
    </div>
    <div class="card">
      <details>
        <summary>
          <span class="card-role">
            Tool result{props.event.isError ? " (error)" : ""}
          </span>
          <Ts ts={props.event.ts} />
        </summary>
        <pre class="card-text card-text--code">
          {prettyJson(props.event.output)}
        </pre>
      </details>
    </div>
  </section>
);

const SubtaskStart = (props: {
  event: Extract<TranscriptEvent, { kind: "subtask_start" }>;
  depth: number;
}) => (
  <div
    class="subtask-boundary subtask-boundary--start"
    role="button"
    tabindex={0}
    aria-expanded="true"
    data-collapsed="false"
    title="Click to collapse this subtask"
    style={depthStyle(props.depth)}
  >
    <span class="subtask-rule" />
    <span class="subtask-label">
      <span class="collapse-chevron" aria-hidden="true">
        ▼
      </span>
      Subtask
      {props.event.agentName && (
        <span class="subtask-agent">{` @${props.event.agentName}`}</span>
      )}
      : {props.event.description}
      {props.event.sessionId && (
        <span class="subtask-id">
          {` ${props.event.sessionId.slice(0, 12)}`}
        </span>
      )}
    </span>
    <span class="subtask-rule" />
  </div>
);

const SubtaskEnd = (props: { depth: number }) => (
  <div
    class="subtask-boundary subtask-boundary--end"
    style={depthStyle(props.depth)}
  >
    <span class="subtask-rule" />
    <span class="subtask-label subtask-label--end">End subtask</span>
    <span class="subtask-rule" />
  </div>
);

/** Dispatch one rendered event to its kind-specific component. SSR
 *  renders this once per event so a plain `switch` (with TypeScript's
 *  narrowing) is cleaner than `Switch`/`Match`. */
const Event = (props: { rendered: RenderedEvent }) => {
  const e = props.rendered.event;
  const depth = props.rendered.depth;
  const bodyHtml = props.rendered.bodyHtml ?? "";
  switch (e.kind) {
    case "user":
      return (
        <UserEvent
          event={e}
          index={props.rendered.index}
          depth={depth}
          bodyHtml={bodyHtml}
        />
      );
    case "assistant":
      return <AssistantEvent event={e} depth={depth} bodyHtml={bodyHtml} />;
    case "reasoning":
      return <ReasoningEvent event={e} depth={depth} bodyHtml={bodyHtml} />;
    case "tool_call":
      return isEditClass(e.inputs) ? (
        <EditEvent event={e} depth={depth} bodyHtml={bodyHtml} />
      ) : (
        <ToolCallEvent event={e} depth={depth} />
      );
    case "tool_result":
      return <ToolResultEvent event={e} depth={depth} />;
    case "subtask_start":
      return <SubtaskStart event={e} depth={depth} />;
    case "subtask_end":
      return <SubtaskEnd depth={depth} />;
  }
};

const Eyebrow = (props: { transcript: Transcript }) => {
  const exportedDate = (() => {
    try {
      return new Date(props.transcript.exportedAt).toLocaleDateString(
        undefined,
        { year: "numeric", month: "short", day: "numeric" },
      );
    } catch {
      return "";
    }
  })();
  return (
    <div class="eyebrow">
      <span>Transcript</span>
      {exportedDate && (
        <>
          <span class="sep">·</span>
          <span>{exportedDate}</span>
        </>
      )}
      <span class="sep">·</span>
      <span>#{props.transcript.sessionId.slice(0, 8)}</span>
    </div>
  );
};

/** Pick the displayed title for the document. Prefers the first user
 *  prompt (one-line, truncated). Claude Code's `summary` field comes
 *  from a rolling SDK summarizer that re-summarises on every turn, so
 *  on long sessions it drifts toward the LATEST prompt — exactly the
 *  opposite of what a session label should mean. The first prompt is
 *  the question that started the conversation and is the most useful
 *  one-line label across all three agents. */
export function deriveDisplayTitle(transcript: Transcript): string {
  for (const ev of transcript.events) {
    if (ev.kind === "user") {
      const firstLine = (ev.text.split(/\r?\n/)[0] ?? "").trim();
      if (firstLine.length > 0) {
        return firstLine.length > 120
          ? `${firstLine.slice(0, 117)}…`
          : firstLine;
      }
    }
  }
  if (transcript.title && transcript.title.length > 0) return transcript.title;
  return `Session ${transcript.sessionId.slice(0, 8)}`;
}

const RichTitle = (props: { transcript: Transcript; titleText: string }) => {
  const { repoName, pr } = props.transcript;
  const hasPrefix = repoName !== null || pr !== null;
  return (
    <h1 class="title">
      {hasPrefix && (
        <span class="title-prefix">
          {repoName && <span class="title-repo">{repoName}</span>}
          {repoName && pr && <span class="title-sep">·</span>}
          {pr && (
            <a
              class="title-pr"
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              PR #{pr.number}
            </a>
          )}
        </span>
      )}
      <span class="title-text">{props.titleText}</span>
    </h1>
  );
};

const Byline = (props: {
  transcript: Transcript;
  counts: { user: number; assistant: number; toolCalls: number };
}) => {
  const { model, contextTokens, cwd, agentKind } = props.transcript;
  return (
    <div class="byline">
      <span class="byline-runtime">
        <span class="byline-agent">{AGENT_LABEL[agentKind]}</span>
        {model && (
          <>
            <span class="byline-rt-sep">·</span>
            <code class="byline-model">{model}</code>
          </>
        )}
        {contextTokens !== null && (
          <>
            <span class="byline-rt-sep">·</span>
            <span class="byline-tokens">
              {formatTokens(contextTokens)} tokens
            </span>
          </>
        )}
      </span>
      <span class="sep">·</span>
      {cwd && (
        <>
          <span>
            <span class="key">Cwd</span> <code>{cwd}</code>
          </span>
          <span class="sep">·</span>
        </>
      )}
      <span>
        {props.counts.user} prompts · {props.counts.assistant} replies ·{" "}
        {props.counts.toolCalls} tools
      </span>
    </div>
  );
};

const Masthead = (props: {
  transcript: Transcript;
  titleText: string;
  counts: { user: number; assistant: number; toolCalls: number };
}) => (
  <header class="masthead">
    <a
      class="brand"
      href="https://kolu.dev/"
      target="_blank"
      rel="noopener noreferrer"
      title="Exported by Kolu — kolu.dev"
    >
      <Icon class="brand-mark" svg={KOLU_LOGO} />
      <span class="brand-name">kolu</span>
    </a>
    <Eyebrow transcript={props.transcript} />
    <RichTitle transcript={props.transcript} titleText={props.titleText} />
    <Byline transcript={props.transcript} counts={props.counts} />
    <hr class="rule" />
  </header>
);

const Dock = () => (
  <aside class="dock" role="toolbar" aria-label="Document controls">
    <button
      type="button"
      class="dock-btn"
      data-toggle="edits"
      aria-pressed="false"
      title="Show or hide agent edits (file diffs)"
    >
      <Icon class="dock-icon" svg={EDIT_DOCK_ICON} />
      <span class="dock-label">Edits</span>
      <span class="dock-state" data-state="">
        shown
      </span>
    </button>
    <button
      type="button"
      class="dock-btn"
      data-toggle="tools"
      aria-pressed="true"
      title="Show or hide tool calls"
    >
      <Icon class="dock-icon" svg={TOOLS_DOCK_ICON} />
      <span class="dock-label">Tools</span>
      <span class="dock-state" data-state="">
        hidden
      </span>
    </button>
    <button
      type="button"
      class="dock-btn"
      data-toggle="reasoning"
      aria-pressed="true"
      title="Show or hide assistant reasoning"
    >
      <Icon class="dock-icon" svg={REASONING_ICON} />
      <span class="dock-label">Reasoning</span>
      <span class="dock-state" data-state="">
        hidden
      </span>
    </button>
    <button
      type="button"
      class="dock-btn"
      data-toggle="theme"
      title="Cycle theme: auto → light → dark"
    >
      <Icon class="dock-icon" svg={THEME_DOCK_ICON} />
      <span class="dock-label">Theme</span>
      <span class="dock-state" data-state="">
        auto
      </span>
    </button>
    <div class="dock-divider" />
    <div class="dock-nav">
      <button
        type="button"
        data-nav="prev"
        title="Previous prompt (k)"
        aria-label="Previous prompt"
      >
        ↑
      </button>
      <span class="dock-pos">
        <span data-nav-pos="">–</span> / <span data-nav-total="">0</span>
      </span>
      <button
        type="button"
        data-nav="next"
        title="Next prompt (j)"
        aria-label="Next prompt"
      >
        ↓
      </button>
    </div>
  </aside>
);

const Footer = () => (
  <footer class="colophon">
    <Icon class="colophon-mark" svg={KOLU_LOGO} />
    <span>
      Exported by{" "}
      <a href="https://kolu.dev/" target="_blank" rel="noopener noreferrer">
        Kolu
      </a>{" "}
      — a workspace for orchestrating AI coding agents.
    </span>
  </footer>
);

const Hint = () => (
  <p class="hint">
    Use <kbd>j</kbd>/<kbd>k</kbd> to move between prompts. The dock at
    lower-right toggles edits, tools, reasoning, and theme.
  </p>
);

/** Tally event counts for the masthead summary line. */
export function countEvents(events: TranscriptEvent[]): {
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

/** Walk events tracking subtask nesting depth. `subtask_start`
 *  increments before render so the start divider sits inside its
 *  parent's indent; `subtask_end` renders at current then decrements
 *  so the boundary aligns with its start. */
export function computeDepths(events: TranscriptEvent[]): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (const e of events) {
    if (e.kind === "subtask_start") {
      depth += 1;
      depths.push(depth);
    } else if (e.kind === "subtask_end") {
      depths.push(depth);
      if (depth > 0) depth -= 1;
    } else {
      depths.push(depth);
    }
  }
  return depths;
}

export const Document = (props: {
  transcript: Transcript;
  titleText: string;
  counts: { user: number; assistant: number; toolCalls: number };
  rendered: RenderedEvent[];
}) => (
  <>
    <article class="doc">
      <Masthead
        transcript={props.transcript}
        titleText={props.titleText}
        counts={props.counts}
      />
      <main class="events">
        {props.rendered.length === 0 ? (
          <div class="empty">No conversation events found.</div>
        ) : (
          props.rendered.map((re) => <Event rendered={re} />)
        )}
      </main>
      <Footer />
      <Hint />
    </article>
    <Dock />
  </>
);
