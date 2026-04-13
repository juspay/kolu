/**
 * File search overlay — fuzzy file finder scoped to the active workspace.
 * Triggered by Cmd+O. Query-driven: sends query to server, displays ranked results.
 */

import {
  type Component,
  type Accessor,
  createSignal,
  createEffect,
  on,
  For,
  Show,
} from "solid-js";
import { makeEventListener } from "@solid-primitives/event-listener";
import Dialog from "@corvu/dialog";
import ModalDialog from "./ModalDialog";
import { formatKeybind, SHORTCUTS } from "./keyboard";
import Kbd from "./Kbd";
import type { FsSearchResult, TerminalMetadata } from "kolu-common";
import { client } from "./rpc";
import { gitStatusTextColor } from "./gitStatusColor";

/** Render a file path with highlighted match positions. */
const HighlightedPath: Component<{
  path: string;
  matches: number[];
}> = (props) => {
  const segments = () => {
    const matchSet = new Set(props.matches);
    const result: Array<{ text: string; matched: boolean }> = [];
    let current = "";
    let isMatch = false;

    for (let i = 0; i < props.path.length; i++) {
      const charMatch = matchSet.has(i);
      if (charMatch !== isMatch && current) {
        result.push({ text: current, matched: isMatch });
        current = "";
      }
      current += props.path[i];
      isMatch = charMatch;
    }
    if (current) result.push({ text: current, matched: isMatch });
    return result;
  };

  return (
    <span class="truncate">
      <For each={segments()}>
        {(seg) =>
          seg.matched ? (
            <span class="text-accent font-semibold">{seg.text}</span>
          ) : (
            <span>{seg.text}</span>
          )
        }
      </For>
    </span>
  );
};

const FileSearch: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeMeta: Accessor<TerminalMetadata | null>;
  onOpenFile: (root: string, filePath: string) => void;
  /** Optional: preview a file without committing (on arrow key). */
  onPreviewFile?: (root: string, filePath: string) => void;
}> = (props) => {
  let inputRef!: HTMLInputElement;
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<FsSearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [searching, setSearching] = createSignal(false);
  let mouseActive = false;
  let searchVersion = 0;

  const root = () => {
    const meta = props.activeMeta();
    return meta?.git?.repoRoot ?? null;
  };

  // Search on query change (debounced)
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(query, (q) => {
      clearTimeout(searchTimer);
      const currentRoot = root();
      if (!currentRoot) {
        setResults([]);
        return;
      }
      const version = ++searchVersion;
      if (!q) {
        // Empty query: show all files (up to limit)
        setSearching(true);
        void client.fs
          .search({ root: currentRoot, query: "", limit: 50 })
          .then((res) => {
            if (searchVersion === version) {
              setResults(res);
              setSearching(false);
            }
          })
          .catch((err: unknown) => {
            // Best-effort: search fails silently (e.g. workspace gone) — user sees "No matching files"
            console.warn("File search failed:", err);
            setSearching(false);
          });
        return;
      }
      searchTimer = setTimeout(() => {
        setSearching(true);
        void client.fs
          .search({ root: currentRoot, query: q, limit: 50 })
          .then((res) => {
            if (searchVersion === version) {
              setResults(res);
              setSelectedIndex(0);
              setSearching(false);
            }
          })
          .catch((err: unknown) => {
            console.warn("File search failed:", err);
            setSearching(false);
          });
      }, 80);
    }),
  );

  function handleKeyDown(e: KeyboardEvent) {
    if (!props.open) return;
    const items = results();
    const key = e.key;
    function previewSelected(idx: number) {
      const selected = items[idx];
      const currentRoot = root();
      if (selected && currentRoot && props.onPreviewFile) {
        props.onPreviewFile(currentRoot, selected.path);
      }
    }

    switch (key) {
      case "ArrowDown":
        if (items.length === 0) return;
        setSelectedIndex((i) => {
          const next = Math.min(i + 1, items.length - 1);
          previewSelected(next);
          return next;
        });
        break;
      case "ArrowUp":
        if (items.length === 0) return;
        setSelectedIndex((i) => {
          const prev = Math.max(i - 1, 0);
          previewSelected(prev);
          return prev;
        });
        break;
      case "Tab":
        if (items.length === 0) return;
        setSelectedIndex((i) => {
          const next = e.shiftKey
            ? (i - 1 + items.length) % items.length
            : (i + 1) % items.length;
          previewSelected(next);
          return next;
        });
        break;
      case "Enter": {
        const selected = items[selectedIndex()];
        const currentRoot = root();
        if (selected && currentRoot) {
          props.onOpenChange(false);
          props.onOpenFile(currentRoot, selected.path);
        }
        break;
      }
      case "Escape":
        props.onOpenChange(false);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  makeEventListener(window, "keydown", handleKeyDown, { capture: true });

  // Reset on open
  createEffect(
    on(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          setQuery("");
          setResults([]);
          setSelectedIndex(0);
          mouseActive = false;
          searchVersion++;
          // Trigger initial load
          const currentRoot = root();
          if (currentRoot) {
            void client.fs
              .search({ root: currentRoot, query: "", limit: 50 })
              .then(setResults)
              .catch(() => {
                // Best-effort initial load — workspace may not exist yet
              });
          }
          requestAnimationFrame(() =>
            requestAnimationFrame(() => inputRef.focus()),
          );
        }
      },
    ),
  );

  return (
    <ModalDialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Content
        forceMount
        data-testid="file-search"
        class="w-lg bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col"
        style={{
          height: "28rem",
          "background-color": "var(--color-surface-1)",
        }}
      >
        <div class="flex items-center gap-2 px-4 py-3 border-b border-edge">
          <svg
            class="w-4 h-4 text-fg-3 shrink-0"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3.5 3.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search files..."
            class="flex-1 bg-transparent text-fg text-sm outline-none placeholder-fg-3"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <Kbd>{formatKeybind(SHORTCUTS.fileBrowser.keybind)}</Kbd>
        </div>
        <div
          class="flex-1 min-h-0 overflow-y-auto"
          onMouseMove={() => (mouseActive = true)}
        >
          <Show
            when={root()}
            fallback={
              <div class="px-4 py-3 text-sm text-fg-3">
                No workspace detected — open a terminal in a git repository
              </div>
            }
          >
            <Show
              when={results().length > 0}
              fallback={
                <div class="px-4 py-3 text-sm text-fg-3">
                  {searching() ? "Searching..." : "No matching files"}
                </div>
              }
            >
              <ul class="py-1">
                <For each={results()}>
                  {(file, i) => (
                    <li
                      ref={(el) => {
                        createEffect(() => {
                          if (selectedIndex() === i())
                            el.scrollIntoView({ block: "nearest" });
                        });
                      }}
                      class="flex items-center gap-2 px-4 py-1.5 text-sm cursor-pointer transition-colors duration-150"
                      classList={{
                        "bg-surface-3 text-fg": selectedIndex() === i(),
                        "text-fg-2 hover:bg-surface-2": selectedIndex() !== i(),
                      }}
                      onMouseEnter={() => mouseActive && setSelectedIndex(i())}
                      onClick={() => {
                        const currentRoot = root();
                        if (currentRoot) {
                          props.onOpenChange(false);
                          props.onOpenFile(currentRoot, file.path);
                        }
                      }}
                    >
                      {/* Git status dot */}
                      <Show when={file.gitStatus}>
                        {(status) => (
                          <span
                            class={`shrink-0 w-2 h-2 rounded-full ${gitStatusTextColor[status()] ?? "text-fg-3"}`}
                            style={{ "background-color": "currentColor" }}
                            title={status()}
                          />
                        )}
                      </Show>
                      <Show when={!file.gitStatus}>
                        <span class="shrink-0 w-2" />
                      </Show>
                      {/* File path with match highlights */}
                      <HighlightedPath
                        path={file.path}
                        matches={file.matches}
                      />
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
        <div class="px-4 py-2 text-[0.7rem] text-fg-3 border-t border-edge flex items-center gap-3">
          <span>
            <kbd class="text-fg-3">↑↓</kbd> navigate
          </span>
          <span>
            <kbd class="text-fg-3">↵</kbd> open
          </span>
          <span>
            <kbd class="text-fg-3">esc</kbd> close
          </span>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default FileSearch;
