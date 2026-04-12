/**
 * Right panel — resizable sidebar hosting Files, Changes, Peek, Diff,
 * and Claude Transcript views inline. Content stays visible alongside
 * the terminal — no modals needed for file/diff context.
 */

import {
  type Component,
  type Accessor,
  createSignal,
  createEffect,
  createMemo,
  createResource,
  on,
  For,
  Show,
} from "solid-js";
import { match } from "ts-pattern";
import { marked } from "marked";
import FileTree from "./FileTree";
import GitChanges from "./GitChanges";
import { client } from "./rpc";
import { gitStatusBgColor } from "./gitStatusColor";
import { formatKeybind, SHORTCUTS } from "./keyboard";
import Kbd from "./Kbd";
import type {
  FsReadFileOutput,
  FsFileDiffOutput,
  DiffHunk,
  TerminalId,
} from "kolu-common";
import type { RightPanelView } from "./useFileBrowser";

// --- Syntax highlighting (shared with former FilePeek) ---

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  rb: "ruby",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  md: "markdown",
  html: "xml",
  xml: "xml",
  css: "css",
  scss: "scss",
  sql: "sql",
  nix: "nix",
  hs: "haskell",
  c: "c",
  cpp: "cpp",
  java: "java",
  dockerfile: "dockerfile",
  feature: "gherkin",
};

function getLang(filePath: string): string | undefined {
  const name = filePath.split("/").pop()?.toLowerCase() ?? "";
  if (EXT_TO_LANG[name]) return EXT_TO_LANG[name];
  const ext = name.split(".").pop() ?? "";
  return EXT_TO_LANG[ext];
}

async function highlightLines(
  code: string,
  lang: string | undefined,
): Promise<string[]> {
  const hljs = (await import("highlight.js")).default;
  let html: string;
  if (lang) {
    try {
      html = hljs.highlight(code, {
        language: lang,
        ignoreIllegals: true,
      }).value;
    } catch {
      html = hljs.highlightAuto(code).value;
    }
  } else {
    html = hljs.highlightAuto(code).value;
  }
  return html.split("\n");
}

type GutterMark = "added" | "modified" | "deleted-below" | null;

function buildGutterMap(diff: FsFileDiffOutput): Map<number, GutterMark> {
  const map = new Map<number, GutterMark>();
  for (const line of diff.addedLines) map.set(line, "added");
  for (const line of diff.modifiedLines) map.set(line, "modified");
  for (const line of diff.deletedAfterLines) {
    if (!map.has(line)) map.set(line, "deleted-below");
  }
  return map;
}

const GUTTER_COLORS: Record<string, string> = {
  added: "bg-green-500",
  modified: "bg-blue-400",
  "deleted-below": "bg-red-500",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// --- Inline Peek View ---

/** Breadcrumb header for detail views — shows "Origin › filename" with back nav. */
const DetailBreadcrumb: Component<{
  origin: string;
  filePath: string;
  onBack: () => void;
  children?: any;
}> = (props) => (
  <div class="flex items-center gap-1.5 px-3 py-2 border-b border-edge shrink-0 min-w-0">
    <button
      class="text-fg-3 hover:text-accent transition-colors text-xs shrink-0"
      onClick={props.onBack}
    >
      {props.origin}
    </button>
    <span class="text-fg-3 text-xs shrink-0">›</span>
    <span class="text-xs text-fg truncate font-mono">{props.filePath}</span>
    <Show when={props.children}>
      <span class="ml-auto shrink-0 flex items-center gap-1.5">
        {props.children}
      </span>
    </Show>
  </div>
);

const PeekView: Component<{
  filePath: string;
  root: string;
  content: FsReadFileOutput;
  onBack: () => void;
  /** Label for the breadcrumb origin (e.g. "Files" or "Changes"). */
  originLabel: string;
}> = (props) => {
  const rawLines = createMemo(() => props.content.content.split("\n"));
  const lineNumWidth = createMemo(() =>
    Math.max(String(rawLines().length).length, 3),
  );

  const [hlLines, setHlLines] = createSignal<string[] | null>(null);
  const [diffData, setDiffData] = createSignal<FsFileDiffOutput | null>(null);
  const gutterMap = createMemo(() =>
    diffData() ? buildGutterMap(diffData()!) : new Map<number, GutterMark>(),
  );

  createEffect(
    on(
      () => [props.content, props.filePath, props.root] as const,
      ([content, filePath, root]) => {
        setHlLines(null);
        setDiffData(null);
        const lang = getLang(filePath);
        void highlightLines(content.content, lang).then(setHlLines);
        void client.fs
          .fileDiff({ root, filePath })
          .then(setDiffData)
          .catch(() => {
            // No diff available
          });
      },
    ),
  );

  return (
    <div class="flex flex-col h-full">
      <DetailBreadcrumb
        origin={props.originLabel}
        filePath={props.filePath}
        onBack={props.onBack}
      >
        <span class="text-[0.65rem] text-fg-3">
          {props.content.lineCount} lines ·{" "}
          {formatBytes(props.content.byteLength)}
        </span>
      </DetailBreadcrumb>
      <div class="flex-1 min-h-0 overflow-auto font-mono text-xs leading-5">
        <table class="w-full border-collapse">
          <tbody>
            <For each={rawLines()}>
              {(line, i) => {
                const lineNum = () => i() + 1;
                const highlighted = () => hlLines()?.[i()];
                const gutter = () => gutterMap().get(lineNum()) ?? null;
                return (
                  <tr class="hover:bg-surface-2 transition-colors">
                    <td class="w-1 p-0">
                      <Show when={gutter()}>
                        {(mark) => (
                          <div
                            class={`w-0.5 h-full ${GUTTER_COLORS[mark()]}`}
                            title={mark()}
                          />
                        )}
                      </Show>
                    </td>
                    <td
                      class="sticky left-0 bg-surface-1 text-fg-3 text-right pr-3 pl-2 select-none border-r border-edge"
                      style={{ width: `${lineNumWidth() + 2}ch` }}
                    >
                      {lineNum()}
                    </td>
                    <Show
                      when={highlighted()}
                      fallback={
                        <td class="pl-3 pr-4 whitespace-pre text-fg">
                          {line || " "}
                        </td>
                      }
                    >
                      {(html) => (
                        <td
                          class="pl-3 pr-4 whitespace-pre text-fg"
                          innerHTML={html() || " "}
                        />
                      )}
                    </Show>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- Inline Diff View ---

const DiffView: Component<{
  root: string;
  filePath: string;
  onBack: () => void;
  originLabel: string;
}> = (props) => {
  const [diff, setDiff] = createSignal<FsFileDiffOutput | null>(null);
  const [loading, setLoading] = createSignal(true);

  createEffect(
    on(
      () => [props.root, props.filePath] as const,
      ([root, filePath]) => {
        setDiff(null);
        setLoading(true);
        void client.fs
          .fileDiff({ root, filePath })
          .then(setDiff)
          .catch((err: unknown) => console.warn("Failed to load diff:", err))
          .finally(() => setLoading(false));
      },
    ),
  );

  const totalAdded = () =>
    diff()?.hunks.reduce(
      (n, h) => n + h.lines.filter((l) => l.kind === "add").length,
      0,
    ) ?? 0;
  const totalRemoved = () =>
    diff()?.hunks.reduce(
      (n, h) => n + h.lines.filter((l) => l.kind === "remove").length,
      0,
    ) ?? 0;

  return (
    <div class="flex flex-col h-full">
      <DetailBreadcrumb
        origin={props.originLabel}
        filePath={props.filePath}
        onBack={props.onBack}
      >
        <Show when={diff()}>
          <span class="text-[0.65rem] text-green-400 font-mono">
            +{totalAdded()}
          </span>
          <span class="text-[0.65rem] text-red-400 font-mono">
            -{totalRemoved()}
          </span>
        </Show>
      </DetailBreadcrumb>
      <div class="flex-1 min-h-0 overflow-auto font-mono text-xs leading-5">
        <Show
          when={!loading()}
          fallback={<div class="p-4 text-fg-3">Loading diff...</div>}
        >
          <Show
            when={diff()?.hunks.length}
            fallback={
              <div class="p-4 text-fg-3 italic">No changes to display</div>
            }
          >
            <table class="w-full border-collapse">
              <tbody>
                <For each={diff()!.hunks}>
                  {(hunk, hunkIdx) => (
                    <>
                      <Show when={hunkIdx() > 0}>
                        <tr>
                          <td
                            colspan="4"
                            class="h-2 bg-surface-0 border-y border-edge/30"
                          />
                        </tr>
                      </Show>
                      <tr class="bg-blue-500/5">
                        <td
                          colspan="4"
                          class="px-3 py-1 text-fg-3 text-[0.65rem] select-none"
                        >
                          @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},
                          {hunk.newCount} @@
                        </td>
                      </tr>
                      <For each={hunk.lines}>
                        {(line) => {
                          const style = match(line.kind)
                            .with("add", () => ({
                              bg: "bg-green-500/10",
                              marker: "+",
                              markerColor: "text-green-400",
                              textColor: "text-green-200",
                            }))
                            .with("remove", () => ({
                              bg: "bg-red-500/10",
                              marker: "-",
                              markerColor: "text-red-400",
                              textColor: "text-red-200",
                            }))
                            .with("context", () => ({
                              bg: "",
                              marker: " ",
                              markerColor: "text-fg-3",
                              textColor: "text-fg-2",
                            }))
                            .exhaustive();
                          return (
                            <tr class={`${style.bg} hover:brightness-110`}>
                              <td class="w-8 text-right pr-1 pl-2 text-fg-3/50 select-none text-[0.6rem]">
                                {line.oldLine ?? ""}
                              </td>
                              <td class="w-8 text-right pr-1 text-fg-3/50 select-none text-[0.6rem] border-r border-edge/20">
                                {line.newLine ?? ""}
                              </td>
                              <td
                                class={`w-4 text-center select-none text-[0.65rem] ${style.markerColor}`}
                              >
                                {style.marker}
                              </td>
                              <td
                                class={`pr-3 whitespace-pre ${style.textColor}`}
                              >
                                {line.content || " "}
                              </td>
                            </tr>
                          );
                        }}
                      </For>
                    </>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </Show>
      </div>
    </div>
  );
};

// --- Session Conversation View ---

/** Extract user text from a user message's content field. */
function extractUserText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c: Record<string, unknown>) => {
        if (c.type === "tool_result")
          return `[Tool result: ${String(c.content ?? "").slice(0, 200)}]`;
        return String(c.text ?? c.content ?? "");
      })
      .join("\n");
  }
  return "";
}

/** Extract renderable blocks from an assistant message's content array. */
function extractAssistantBlocks(
  content: unknown[],
): Array<
  | { kind: "text"; text: string }
  | { kind: "tool_use"; name: string; input: string }
  | { kind: "thinking"; text: string }
> {
  const blocks: Array<
    | { kind: "text"; text: string }
    | { kind: "tool_use"; name: string; input: string }
    | { kind: "thinking"; text: string }
  > = [];
  for (const item of content) {
    const c = item as Record<string, unknown>;
    if (c.type === "text" && typeof c.text === "string" && c.text.trim()) {
      blocks.push({ kind: "text", text: c.text });
    } else if (c.type === "tool_use" && typeof c.name === "string") {
      blocks.push({
        kind: "tool_use",
        name: c.name,
        input: JSON.stringify(c.input, null, 2).slice(0, 500),
      });
    } else if (
      c.type === "thinking" &&
      typeof c.thinking === "string" &&
      c.thinking.trim()
    ) {
      blocks.push({ kind: "thinking", text: c.thinking.slice(0, 300) });
    }
  }
  return blocks;
}

type ConversationMsg = {
  role: "user" | "assistant";
  timestamp: string;
  text?: string;
  blocks?: ReturnType<typeof extractAssistantBlocks>;
  model?: string;
};

/** Parse raw JSONL events into a conversation thread (user + assistant messages only). */
function parseConversation(events: unknown[]): ConversationMsg[] {
  const messages: ConversationMsg[] = [];
  for (const ev of events) {
    const e = ev as Record<string, unknown>;
    const ts = typeof e.timestamp === "string" ? e.timestamp : "";
    if (e.type === "user" && e.message) {
      const msg = e.message as Record<string, unknown>;
      const text = extractUserText(msg.content);
      // Skip internal tool results
      if (text && !text.startsWith("[Tool result:")) {
        messages.push({ role: "user", timestamp: ts, text });
      }
    } else if (e.type === "assistant" && e.message) {
      const msg = e.message as Record<string, unknown>;
      if (Array.isArray(msg.content)) {
        const blocks = extractAssistantBlocks(msg.content);
        if (blocks.length > 0) {
          messages.push({
            role: "assistant",
            timestamp: ts,
            blocks,
            model: typeof msg.model === "string" ? msg.model : undefined,
          });
        }
      }
    }
  }
  return messages;
}

function formatTime(ts: string): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Render markdown to HTML. Synchronous — marked is fast enough for inline use. */
function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false, breaks: true }) as string;
}

const TranscriptView: Component<{
  terminalId: Accessor<TerminalId | null>;
}> = (props) => {
  const [snapshot] = createResource(
    () => props.terminalId(),
    (id) => client.claude.getTranscript({ id }),
  );

  const conversation = createMemo(() => {
    const snap = snapshot();
    if (!snap) return [];
    return parseConversation(snap.rawEvents);
  });

  /** Open a standalone HTML page with the conversation, ready for print/PDF. */
  function handlePrint() {
    const msgs = conversation();
    if (msgs.length === 0) return;

    const lines = msgs.map((msg) => {
      if (msg.role === "user") {
        return `<div style="margin:16px 0;padding:12px 16px;background:#f0f4f8;border-radius:8px;border-left:3px solid #3b82f6">
          <div style="font-size:11px;color:#6b7280;margin-bottom:4px">You &middot; ${escapeHtml(formatTime(msg.timestamp))}</div>
          <div style="white-space:pre-wrap">${escapeHtml(msg.text ?? "")}</div></div>`;
      }
      const blocks = (msg.blocks ?? [])
        .map((b) => {
          if (b.kind === "text") return renderMarkdown(b.text);
          if (b.kind === "tool_use")
            return `<div style="margin:8px 0;padding:8px 12px;background:#f3f4f6;border-radius:4px;font-family:monospace;font-size:12px">
              <div style="color:#6366f1;font-weight:600;margin-bottom:4px">${escapeHtml(b.name)}</div>
              <pre style="margin:0;overflow:auto;font-size:11px;color:#4b5563">${escapeHtml(b.input)}</pre></div>`;
          if (b.kind === "thinking")
            return `<div style="margin:4px 0;padding:8px;color:#9ca3af;font-style:italic;font-size:12px;border-left:2px solid #d1d5db">${escapeHtml(b.text)}${b.text.length >= 300 ? "..." : ""}</div>`;
          return "";
        })
        .join("");
      return `<div style="margin:16px 0;padding:12px 16px;background:#faf5ff;border-radius:8px;border-left:3px solid #8b5cf6">
        <div style="font-size:11px;color:#6b7280;margin-bottom:4px">Claude${msg.model ? ` &middot; ${escapeHtml(msg.model)}` : ""} &middot; ${escapeHtml(formatTime(msg.timestamp))}</div>
        ${blocks}</div>`;
    });

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Claude Session</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:800px;margin:0 auto;padding:24px;color:#1f2937;font-size:14px;line-height:1.6}
code{background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:0.9em;font-family:ui-monospace,monospace}
pre{background:#f3f4f6;padding:12px 16px;border-radius:6px;overflow-x:auto;font-size:0.85em;margin:8px 0}
pre code{background:none;padding:0}
blockquote{border-left:3px solid #d1d5db;padding-left:12px;margin:8px 0;color:#6b7280}
h1,h2,h3{margin:12px 0 4px;font-weight:600}
ul,ol{padding-left:24px}
@media print{body{padding:12px}}</style></head>
<body><h1 style="font-size:18px;border-bottom:1px solid #e5e7eb;padding-bottom:12px;margin-bottom:8px">Claude Session Transcript</h1>
${lines.join("\n")}</body></html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 300);
    }
  }

  return (
    <div class="flex flex-col h-full" data-testid="transcript-view">
      <div class="flex items-center justify-between px-3 py-2 border-b border-edge">
        <span class="text-xs font-semibold text-fg">Session</span>
        <Show when={conversation().length > 0}>
          <button
            class="text-[0.65rem] text-fg-3 hover:text-fg transition-colors px-2 py-0.5 rounded bg-surface-2 hover:bg-surface-3"
            onClick={handlePrint}
            title="Open printable transcript in new tab"
          >
            Print
          </button>
        </Show>
      </div>
      <div class="flex-1 min-h-0 overflow-auto">
        <Show
          when={!snapshot.loading}
          fallback={<div class="p-4 text-xs text-fg-3">Loading session...</div>}
        >
          <Show
            when={conversation().length > 0}
            fallback={
              <div class="flex-1 flex items-center justify-center text-fg-3 text-xs px-4 py-8 text-center">
                {snapshot.error instanceof Error
                  ? `Failed: ${snapshot.error.message}`
                  : "No active Claude session for this terminal."}
              </div>
            }
          >
            <div class="px-3 py-2 space-y-3">
              <For each={conversation()}>
                {(msg) => (
                  <Show
                    when={msg.role === "user"}
                    fallback={
                      /* Assistant message */
                      <div class="rounded-lg border border-edge/50 overflow-hidden">
                        <div class="px-3 py-1.5 bg-surface-0 text-[0.6rem] text-fg-3 flex items-center gap-1.5">
                          <span class="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                          <span class="font-medium">Claude</span>
                          <Show when={msg.model}>
                            <span class="text-fg-3/60">{msg.model}</span>
                          </Show>
                          <span class="ml-auto">
                            {formatTime(msg.timestamp)}
                          </span>
                        </div>
                        <div class="px-3 py-2 space-y-2">
                          <For each={msg.blocks ?? []}>
                            {(block) =>
                              match(block)
                                .with({ kind: "text" }, (b) => (
                                  <div
                                    class="text-xs text-fg leading-relaxed prose prose-xs prose-invert max-w-none"
                                    innerHTML={renderMarkdown(b.text)}
                                  />
                                ))
                                .with({ kind: "tool_use" }, (b) => (
                                  <details class="text-[0.65rem]">
                                    <summary class="text-accent cursor-pointer hover:underline font-mono">
                                      {b.name}
                                    </summary>
                                    <pre class="mt-1 p-2 bg-surface-0 rounded text-fg-3 font-mono overflow-auto max-h-32 text-[0.6rem]">
                                      {b.input}
                                    </pre>
                                  </details>
                                ))
                                .with({ kind: "thinking" }, (b) => (
                                  <div class="text-[0.65rem] text-fg-3 italic border-l-2 border-edge pl-2">
                                    {b.text}
                                    {b.text.length >= 300 ? "..." : ""}
                                  </div>
                                ))
                                .exhaustive()
                            }
                          </For>
                        </div>
                      </div>
                    }
                  >
                    {/* User message */}
                    <div class="rounded-lg bg-accent/10 border border-accent/20 px-3 py-2">
                      <div class="text-[0.6rem] text-fg-3 mb-1 flex items-center gap-1.5">
                        <span class="font-medium">You</span>
                        <span class="ml-auto">{formatTime(msg.timestamp)}</span>
                      </div>
                      <div class="text-xs text-fg whitespace-pre-wrap leading-relaxed">
                        {msg.text}
                      </div>
                    </div>
                  </Show>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

// --- Main Right Panel ---

const RightPanel: Component<{
  view: RightPanelView;
  onViewChange: (view: RightPanelView) => void;
  fileTreeRoot: Accessor<string | null>;
  onOpenFile: (root: string, filePath: string) => void;
  onOpenDiff: (root: string, filePath: string) => void;
  peekFile: {
    path: string;
    root: string;
    content: FsReadFileOutput;
  } | null;
  diffTarget: { root: string; filePath: string } | null;
  /** Label of the list view the user navigated from (for breadcrumb). */
  originLabel: string;
  onBack: () => void;
  terminalId: Accessor<TerminalId | null>;
}> = (props) => {
  const isListView = () =>
    props.view === "files" ||
    props.view === "changes" ||
    props.view === "transcript";

  return (
    <div
      data-testid="right-panel"
      class="flex flex-col h-full bg-surface-1 border-l border-edge"
    >
      {/* Tab bar — only for list views */}
      <Show when={isListView()}>
        <div class="flex shrink-0 border-b border-edge">
          <button
            class="flex-1 px-2 py-1.5 text-[0.65rem] font-medium transition-colors text-center"
            classList={{
              "text-fg border-b-2 border-accent": props.view === "files",
              "text-fg-3 hover:text-fg-2": props.view !== "files",
            }}
            onClick={() => props.onViewChange("files")}
          >
            Files
          </button>
          <button
            class="flex-1 px-2 py-1.5 text-[0.65rem] font-medium transition-colors text-center"
            classList={{
              "text-fg border-b-2 border-accent": props.view === "changes",
              "text-fg-3 hover:text-fg-2": props.view !== "changes",
            }}
            onClick={() => props.onViewChange("changes")}
          >
            Changes
          </button>
          <button
            class="flex-1 px-2 py-1.5 text-[0.65rem] font-medium transition-colors text-center"
            classList={{
              "text-fg border-b-2 border-accent": props.view === "transcript",
              "text-fg-3 hover:text-fg-2": props.view !== "transcript",
            }}
            onClick={() => props.onViewChange("transcript")}
          >
            Transcript
          </button>
        </div>
      </Show>

      {/* Content */}
      <div class="flex-1 min-h-0">
        {match(props.view)
          .with("files", () => (
            <div class="h-full overflow-y-auto">
              <Show
                when={props.fileTreeRoot()}
                fallback={
                  <div class="px-3 py-4 text-xs text-fg-3 italic">
                    Open a terminal in a git repository to browse files
                  </div>
                }
              >
                <FileTree
                  root={props.fileTreeRoot}
                  onOpenFile={props.onOpenFile}
                />
              </Show>
            </div>
          ))
          .with("changes", () => (
            <div class="h-full overflow-y-auto">
              <Show
                when={props.fileTreeRoot()}
                fallback={
                  <div class="px-3 py-4 text-xs text-fg-3 italic">
                    Open a terminal in a git repository to see changes
                  </div>
                }
              >
                <GitChanges
                  root={props.fileTreeRoot}
                  onOpenDiff={props.onOpenDiff}
                />
              </Show>
            </div>
          ))
          .with("peek", () => (
            <Show when={props.peekFile}>
              {(file) => (
                <PeekView
                  filePath={file().path}
                  root={file().root}
                  content={file().content}
                  onBack={props.onBack}
                  originLabel={props.originLabel}
                />
              )}
            </Show>
          ))
          .with("diff", () => (
            <Show when={props.diffTarget}>
              {(target) => (
                <DiffView
                  root={target().root}
                  filePath={target().filePath}
                  onBack={props.onBack}
                  originLabel={props.originLabel}
                />
              )}
            </Show>
          ))
          .with("transcript", () => (
            <TranscriptView terminalId={props.terminalId} />
          ))
          .exhaustive()}
      </div>

      {/* Footer */}
      <div class="shrink-0 px-3 py-1.5 border-t border-edge text-[0.65rem] text-fg-3 flex items-center gap-2">
        <Kbd>{formatKeybind(SHORTCUTS.toggleRightPanel.keybind)}</Kbd>
        <span>toggle panel</span>
      </div>
    </div>
  );
};

export default RightPanel;
