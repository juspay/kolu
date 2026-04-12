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

const PeekView: Component<{
  filePath: string;
  root: string;
  content: FsReadFileOutput;
  onBack: () => void;
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
      {/* Header */}
      <div class="flex items-center gap-2 px-3 py-2 border-b border-edge shrink-0">
        <button
          class="text-fg-3 hover:text-fg transition-colors"
          onClick={props.onBack}
          title="Back"
        >
          <svg
            class="w-3.5 h-3.5"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M8 2L4 6l4 4" />
          </svg>
        </button>
        <span class="text-xs text-fg truncate font-mono">{props.filePath}</span>
        <span class="ml-auto text-[0.65rem] text-fg-3 shrink-0">
          {props.content.lineCount} lines ·{" "}
          {formatBytes(props.content.byteLength)}
        </span>
      </div>
      {/* Content */}
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
      {/* Header */}
      <div class="flex items-center gap-2 px-3 py-2 border-b border-edge shrink-0">
        <button
          class="text-fg-3 hover:text-fg transition-colors"
          onClick={props.onBack}
          title="Back"
        >
          <svg
            class="w-3.5 h-3.5"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M8 2L4 6l4 4" />
          </svg>
        </button>
        <span class="text-xs text-fg truncate font-mono">{props.filePath}</span>
        <Show when={diff()}>
          <span class="text-[0.65rem] text-green-400 font-mono shrink-0">
            +{totalAdded()}
          </span>
          <span class="text-[0.65rem] text-red-400 font-mono shrink-0">
            -{totalRemoved()}
          </span>
        </Show>
      </div>
      {/* Diff content */}
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

// --- Inline Transcript View ---

const TranscriptView: Component<{
  terminalId: Accessor<TerminalId | null>;
}> = (props) => {
  const [snapshot] = createResource(
    () => props.terminalId(),
    (id) => client.claude.getTranscript({ id }),
  );

  return (
    <div class="flex flex-col h-full">
      <div class="px-3 py-2 border-b border-edge text-xs font-semibold text-fg">
        Claude transcript
      </div>
      <Show
        when={snapshot()}
        fallback={
          <div class="flex-1 flex items-center justify-center text-fg-3 text-xs px-4 text-center">
            {snapshot.loading
              ? "Loading..."
              : snapshot.error instanceof Error
                ? `Failed: ${snapshot.error.message}`
                : "No active Claude session for this terminal."}
          </div>
        }
      >
        {(snap) => (
          <>
            <div class="px-3 py-1.5 border-b border-edge text-[0.65rem] text-fg-3 font-mono break-all">
              <div>{snap().transcriptPath}</div>
              <div>since {new Date(snap().startedAt).toLocaleTimeString()}</div>
            </div>
            <div class="flex-1 grid grid-cols-2 min-h-0">
              <section class="flex flex-col min-h-0 border-r border-edge">
                <header class="px-3 py-1.5 text-[0.65rem] font-semibold text-fg-2 border-b border-edge">
                  Server ({snap().stateChanges.length})
                </header>
                <pre class="flex-1 overflow-auto px-3 py-1.5 text-[0.6rem] font-mono text-fg whitespace-pre-wrap">
                  <For
                    each={snap().stateChanges}
                    fallback={
                      <span class="text-fg-3">No transitions yet.</span>
                    }
                  >
                    {(change) => (
                      <div>
                        {new Date(change.ts).toLocaleTimeString()}{" "}
                        {change.info
                          ? `${change.info.state}${change.info.model ? ` (${change.info.model})` : ""}`
                          : "session ended"}
                      </div>
                    )}
                  </For>
                </pre>
              </section>
              <section class="flex flex-col min-h-0">
                <header class="px-3 py-1.5 text-[0.65rem] font-semibold text-fg-2 border-b border-edge">
                  Disk ({snap().rawEvents.length})
                </header>
                <pre class="flex-1 overflow-auto px-3 py-1.5 text-[0.6rem] font-mono text-fg whitespace-pre-wrap">
                  <For
                    each={snap().rawEvents}
                    fallback={<span class="text-fg-3">No events yet.</span>}
                  >
                    {(ev) => <div>{JSON.stringify(ev)}</div>}
                  </For>
                </pre>
              </section>
            </div>
          </>
        )}
      </Show>
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
