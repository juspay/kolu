/**
 * File peek modal — read-only view of file contents with line numbers
 * and syntax highlighting via highlight.js (lazy-loaded on first open).
 * Deliberately no editing — Kolu is terminal-first, the file browser's
 * job is navigation and context, not authoring.
 */

import {
  type Component,
  Show,
  For,
  createMemo,
  createSignal,
  createEffect,
  on,
} from "solid-js";
import Dialog from "@corvu/dialog";
import ModalDialog from "./ModalDialog";
import type { FsReadFileOutput } from "kolu-common";

/** Map file extension to highlight.js language name. */
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
  fish: "bash",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  md: "markdown",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  sql: "sql",
  nix: "nix",
  hs: "haskell",
  ex: "elixir",
  exs: "elixir",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  lua: "lua",
  vim: "vim",
  dockerfile: "dockerfile",
  makefile: "makefile",
  feature: "gherkin",
};

function getLang(filePath: string): string | undefined {
  const name = filePath.split("/").pop()?.toLowerCase() ?? "";
  // Handle extensionless files like Dockerfile, Makefile
  if (EXT_TO_LANG[name]) return EXT_TO_LANG[name];
  const ext = name.split(".").pop() ?? "";
  return EXT_TO_LANG[ext];
}

/** Lazy-load highlight.js and highlight code. Returns HTML lines. */
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
      // Language not registered — fall back to auto-detect
      html = hljs.highlightAuto(code).value;
    }
  } else {
    html = hljs.highlightAuto(code).value;
  }
  return html.split("\n");
}

const FilePeek: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string | null;
  content: FsReadFileOutput | null;
}> = (props) => {
  const rawLines = createMemo(() => {
    if (!props.content) return [];
    return props.content.content.split("\n");
  });

  const lineNumWidth = createMemo(() => {
    const count = rawLines().length;
    return Math.max(String(count).length, 3);
  });

  // Highlighted HTML lines — populated async after content loads
  const [hlLines, setHlLines] = createSignal<string[] | null>(null);

  // Trigger highlighting when content or filePath changes
  createEffect(
    on(
      () => [props.content, props.filePath] as const,
      ([content, filePath]) => {
        setHlLines(null);
        if (!content || !filePath) return;
        const lang = getLang(filePath);
        void highlightLines(content.content, lang).then(setHlLines);
      },
    ),
  );

  return (
    <ModalDialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Content
        data-testid="file-peek"
        class="w-3xl max-w-[90vw] bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col"
        style={{
          height: "min(36rem, 80vh)",
          "background-color": "var(--color-surface-1)",
        }}
      >
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-2.5 border-b border-edge">
          <div class="flex items-center gap-2 min-w-0">
            <svg
              class="w-4 h-4 text-fg-3 shrink-0"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M3 1h7l4 4v10a1 1 0 01-1 1H3a1 1 0 01-1-1V2a1 1 0 011-1zm6 0v4h4" />
            </svg>
            <span class="text-sm text-fg truncate font-mono">
              {props.filePath}
            </span>
          </div>
          <div class="flex items-center gap-3 text-xs text-fg-3 shrink-0">
            <Show when={props.content}>
              {(c) => (
                <>
                  <span>{c().lineCount} lines</span>
                  <span>{formatBytes(c().byteLength)}</span>
                  <Show when={c().truncated}>
                    <span class="text-yellow-400">truncated</span>
                  </Show>
                </>
              )}
            </Show>
            <button
              class="text-fg-3 hover:text-fg transition-colors"
              onClick={() => props.onOpenChange(false)}
              title="Close"
            >
              <svg
                class="w-4 h-4"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>
        {/* Content */}
        <div class="flex-1 min-h-0 overflow-auto font-mono text-xs leading-5">
          <Show
            when={props.content}
            fallback={<div class="p-4 text-fg-3">Loading...</div>}
          >
            <table class="w-full border-collapse">
              <tbody>
                <For each={rawLines()}>
                  {(line, i) => {
                    const highlighted = () => hlLines()?.[i()];
                    return (
                      <tr class="hover:bg-surface-2 transition-colors">
                        <td
                          class="sticky left-0 bg-surface-1 text-fg-3 text-right pr-3 pl-3 select-none border-r border-edge"
                          style={{ width: `${lineNumWidth() + 2}ch` }}
                        >
                          {i() + 1}
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
          </Show>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default FilePeek;
