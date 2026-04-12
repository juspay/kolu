/**
 * Git changes list — shows modified/added/deleted files with a toggle
 * between "list only" (click to open diff in panel) and "full diff"
 * (all diffs expanded inline). Selective mode lets you expand individual
 * files without committing to the full-diff view.
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
}> = (props) => {
  const [changedFiles, setChangedFiles] = createSignal<FsSearchResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  /** "list" = click opens in panel; "full" = all diffs inline; "selective" = individual toggles. */
  const [mode, setMode] = createSignal<"list" | "full">("list");
  /** Which files are individually expanded (used in list mode). */
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({});

  createEffect(
    on(props.root, (root) => {
      setChangedFiles([]);
      setExpanded({});
      if (!root) return;
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
    }),
  );

  function toggleFile(path: string) {
    setExpanded(
      produce((s) => {
        s[path] = !s[path];
      }),
    );
  }

  return (
    <div class="py-1">
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
            {(file) => {
              const showDiff = () => mode() === "full" || !!expanded[file.path];
              return (
                <div>
                  <div class="flex items-center gap-1 w-full text-left px-2 py-1 text-xs hover:bg-surface-2 transition-colors group">
                    {/* Expand toggle (in list mode) */}
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
                        ? "●"
                        : file.staging === "partial"
                          ? "◐"
                          : ""}
                    </span>
                    {/* File path — click opens in panel diff view */}
                    <button
                      class="truncate text-fg-2 group-hover:text-fg text-left min-w-0 flex-1"
                      onClick={() => {
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
