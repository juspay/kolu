/**
 * Git changes list — shows modified/added/deleted files with a toggle
 * between "list only" (click to open diff in panel) and "full diff"
 * (all diffs expanded inline). Selective mode lets you expand individual
 * files without committing to the full-diff view.
 *
 * Stage/unstage buttons per file. Keyboard nav with j/k.
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
import { createStore, produce } from "solid-js/store";
import { match } from "ts-pattern";
import { client } from "./rpc";
import type { FsSearchResult, FsFileDiffOutput } from "kolu-common";

const STATUS_LABEL: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

const STATUS_COLOR: Record<string, string> = {
  modified: "text-yellow-400",
  added: "text-green-400",
  deleted: "text-red-400",
  renamed: "text-blue-400",
  untracked: "text-green-300",
};

/** Inline diff for a single file — fetches and renders on mount. */
const InlineDiff: Component<{ root: string; filePath: string }> = (props) => {
  const [diff, setDiff] = createSignal<FsFileDiffOutput | null>(null);
  const [loading, setLoading] = createSignal(true);

  createEffect(
    on(
      () => [props.root, props.filePath] as const,
      ([root, filePath]) => {
        setLoading(true);
        void client.fs
          .fileDiff({ root, filePath })
          .then(setDiff)
          .catch(() => {})
          .finally(() => setLoading(false));
      },
    ),
  );

  return (
    <div class="border-t border-edge/30 bg-surface-0">
      <Show
        when={!loading()}
        fallback={
          <div class="px-3 py-1 text-[0.6rem] text-fg-3">Loading...</div>
        }
      >
        <Show
          when={diff()?.hunks.length}
          fallback={
            <div class="px-3 py-1 text-[0.6rem] text-fg-3 italic">No diff</div>
          }
        >
          <div class="font-mono text-[0.6rem] leading-4">
            <For each={diff()!.hunks}>
              {(hunk) => (
                <>
                  <div class="px-2 py-0.5 text-fg-3 bg-blue-500/5 select-none">
                    @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},
                    {hunk.newCount} @@
                  </div>
                  <For each={hunk.lines}>
                    {(line) => {
                      const s = match(line.kind)
                        .with("add", () => ({
                          bg: "bg-green-500/10",
                          m: "+",
                          mc: "text-green-400",
                          tc: "text-green-200",
                        }))
                        .with("remove", () => ({
                          bg: "bg-red-500/10",
                          m: "-",
                          mc: "text-red-400",
                          tc: "text-red-200",
                        }))
                        .with("context", () => ({
                          bg: "",
                          m: " ",
                          mc: "text-fg-3",
                          tc: "text-fg-2",
                        }))
                        .exhaustive();
                      return (
                        <div class={`flex ${s.bg}`}>
                          <span class="shrink-0 w-7 text-right pr-1 text-fg-3/50 select-none">
                            {line.oldLine ?? ""}
                          </span>
                          <span class="shrink-0 w-7 text-right pr-1 text-fg-3/50 select-none">
                            {line.newLine ?? ""}
                          </span>
                          <span
                            class={`shrink-0 w-3 text-center select-none ${s.mc}`}
                          >
                            {s.m}
                          </span>
                          <span
                            class={`whitespace-pre overflow-hidden ${s.tc}`}
                          >
                            {line.content || " "}
                          </span>
                        </div>
                      );
                    }}
                  </For>
                </>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

const GitChanges: Component<{
  root: Accessor<string | null>;
  onOpenDiff: (root: string, filePath: string) => void;
  onStageFile: (root: string, filePath: string) => void;
  onUnstageFile: (root: string, filePath: string) => void;
  /** Refresh signal — increments when fs changes are detected. */
  refreshSignal?: Accessor<number>;
}> = (props) => {
  const [changedFiles, setChangedFiles] = createSignal<FsSearchResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  /** "list" = click opens in panel; "full" = all diffs inline. */
  const [mode, setMode] = createSignal<"list" | "full">("list");
  /** Which files are individually expanded (used in list mode). */
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({});
  const [selectedIdx, setSelectedIdx] = createSignal(-1);
  let containerRef!: HTMLDivElement;

  function fetchChanges(root: string) {
    setLoading(true);
    void client.fs
      .search({ root, query: "", limit: 500 })
      .then((results) => {
        setChangedFiles(results.filter((f) => f.gitStatus !== null));
      })
      .catch(() => {
        // Best-effort: workspace may not exist
      })
      .finally(() => setLoading(false));
  }

  createEffect(
    on(props.root, (root) => {
      setChangedFiles([]);
      setExpanded({});
      setSelectedIdx(-1);
      if (!root) return;
      fetchChanges(root);
    }),
  );

  // Refresh when fs changes
  createEffect(
    on(
      () => props.refreshSignal?.(),
      () => {
        const root = props.root();
        if (root) fetchChanges(root);
      },
      { defer: true },
    ),
  );

  function toggleFile(path: string) {
    setExpanded(
      produce((s) => {
        s[path] = !s[path];
      }),
    );
  }

  // Keyboard navigation
  function handleKeyDown(e: KeyboardEvent) {
    const items = changedFiles();
    if (items.length === 0) return;
    const current = selectedIdx();

    switch (e.key) {
      case "j":
      case "ArrowDown": {
        e.preventDefault();
        const next = Math.min(current + 1, items.length - 1);
        setSelectedIdx(next);
        containerRef
          ?.querySelectorAll("[data-change-index]")
          [next]?.scrollIntoView({ block: "nearest" });
        break;
      }
      case "k":
      case "ArrowUp": {
        e.preventDefault();
        const prev = Math.max(current - 1, 0);
        setSelectedIdx(prev);
        containerRef
          ?.querySelectorAll("[data-change-index]")
          [prev]?.scrollIntoView({ block: "nearest" });
        break;
      }
      case "Enter": {
        const file = items[current];
        const root = props.root();
        if (file && root) {
          e.preventDefault();
          props.onOpenDiff(root, file.path);
        }
        break;
      }
      case "l":
      case "ArrowRight": {
        const file = items[current];
        if (file) {
          e.preventDefault();
          if (!expanded[file.path]) toggleFile(file.path);
        }
        break;
      }
      case "h":
      case "ArrowLeft": {
        const file = items[current];
        if (file) {
          e.preventDefault();
          if (expanded[file.path]) toggleFile(file.path);
        }
        break;
      }
      case "s": {
        // Stage/unstage with 's' key
        const file = items[current];
        const root = props.root();
        if (file && root) {
          e.preventDefault();
          if (file.staging === "staged") {
            props.onUnstageFile(root, file.path);
          } else {
            props.onStageFile(root, file.path);
          }
        }
        break;
      }
      case "Escape": {
        setSelectedIdx(-1);
        break;
      }
    }
  }

  return (
    <div
      ref={containerRef}
      class="py-1 outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <Show
        when={!loading()}
        fallback={
          <div class="px-3 py-2 text-xs text-fg-3">Loading changes...</div>
        }
      >
        <Show
          when={changedFiles().length > 0}
          fallback={
            <Show when={props.root()}>
              <div class="px-3 py-4 text-xs text-fg-3 italic text-center">
                No uncommitted changes
              </div>
            </Show>
          }
        >
          {/* Header with count + mode toggle */}
          <div class="flex items-center justify-between px-3 py-1.5">
            <span class="text-[0.65rem] text-fg-3 font-medium uppercase tracking-wider">
              {changedFiles().length} changed{" "}
              {changedFiles().length === 1 ? "file" : "files"}
            </span>
            <button
              class="text-[0.6rem] px-1.5 py-0.5 rounded transition-colors"
              classList={{
                "text-accent bg-accent/10": mode() === "full",
                "text-fg-3 hover:text-fg-2 hover:bg-surface-2":
                  mode() !== "full",
              }}
              onClick={() => setMode((m) => (m === "full" ? "list" : "full"))}
              title={
                mode() === "full"
                  ? "Collapse all diffs"
                  : "Expand all diffs inline"
              }
            >
              {mode() === "full" ? "Collapse all" : "Expand all"}
            </button>
          </div>
          <For each={changedFiles()}>
            {(file, i) => {
              const showDiff = () => mode() === "full" || !!expanded[file.path];
              return (
                <div data-change-index={i()}>
                  <div
                    class="flex items-center gap-1 w-full text-left px-2 py-1 text-xs transition-colors group"
                    classList={{
                      "bg-accent/15": selectedIdx() === i(),
                      "hover:bg-surface-2": selectedIdx() !== i(),
                    }}
                  >
                    {/* Expand toggle */}
                    <button
                      class="shrink-0 w-3 text-fg-3 hover:text-fg transition-colors"
                      onClick={() => toggleFile(file.path)}
                      title={showDiff() ? "Collapse" : "Expand inline"}
                    >
                      <svg
                        class="w-2.5 h-2.5 transition-transform"
                        classList={{ "rotate-90": showDiff() }}
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M4 2l4 4-4 4" />
                      </svg>
                    </button>
                    {/* Status badge */}
                    <span
                      class={`shrink-0 text-[0.6rem] font-bold w-3 text-center ${STATUS_COLOR[file.gitStatus!] ?? "text-fg-3"}`}
                    >
                      {STATUS_LABEL[file.gitStatus!] ?? "?"}
                    </span>
                    {/* Staging indicator */}
                    <span
                      class="shrink-0 text-[0.55rem] w-1.5"
                      title={
                        file.staging === "staged"
                          ? "Staged"
                          : file.staging === "partial"
                            ? "Partially staged"
                            : "Unstaged"
                      }
                    >
                      {file.staging === "staged"
                        ? "\u25CF"
                        : file.staging === "partial"
                          ? "\u25D0"
                          : ""}
                    </span>
                    {/* File path — click opens in panel diff view */}
                    <button
                      class="truncate text-fg-2 group-hover:text-fg text-left min-w-0 flex-1"
                      onClick={() => {
                        setSelectedIdx(i());
                        const root = props.root();
                        if (root) props.onOpenDiff(root, file.path);
                      }}
                    >
                      <Show when={file.path.includes("/")} fallback={file.name}>
                        <span class="text-fg-3">
                          {file.path.slice(0, file.path.lastIndexOf("/") + 1)}
                        </span>
                        {file.name}
                      </Show>
                    </button>
                    {/* Stage/unstage button */}
                    <button
                      class="shrink-0 text-[0.55rem] px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      classList={{
                        "text-green-400 hover:bg-green-500/10":
                          file.staging !== "staged",
                        "text-yellow-400 hover:bg-yellow-500/10":
                          file.staging === "staged",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        const root = props.root();
                        if (!root) return;
                        if (file.staging === "staged") {
                          props.onUnstageFile(root, file.path);
                        } else {
                          props.onStageFile(root, file.path);
                        }
                      }}
                      title={
                        file.staging === "staged"
                          ? "Unstage file"
                          : "Stage file"
                      }
                    >
                      {file.staging === "staged" ? "Unstage" : "Stage"}
                    </button>
                  </div>
                  {/* Inline diff — shown when expanded */}
                  <Show when={showDiff() && props.root()}>
                    <InlineDiff root={props.root()!} filePath={file.path} />
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </Show>
    </div>
  );
};

export default GitChanges;
