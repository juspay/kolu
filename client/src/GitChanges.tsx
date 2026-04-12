/**
 * Git changes sidebar list — shows modified/added/deleted files.
 * Clicking a file opens the diff in a full-width modal (DiffModal).
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
import { client } from "./rpc";
import type { FsSearchResult } from "kolu-common";

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

const GitChanges: Component<{
  root: Accessor<string | null>;
  onOpenDiff: (root: string, filePath: string) => void;
}> = (props) => {
  const [changedFiles, setChangedFiles] = createSignal<FsSearchResult[]>([]);
  const [loading, setLoading] = createSignal(false);

  // Fetch changed files when root changes
  createEffect(
    on(props.root, (root) => {
      setChangedFiles([]);
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
          <div class="px-3 py-1.5 text-[0.65rem] text-fg-3 font-medium uppercase tracking-wider">
            {changedFiles().length} changed{" "}
            {changedFiles().length === 1 ? "file" : "files"}
          </div>
          <For each={changedFiles()}>
            {(file) => (
              <button
                class="flex items-center gap-1.5 w-full text-left px-2 py-1 text-xs hover:bg-surface-2 transition-colors group"
                onClick={() => {
                  const root = props.root();
                  if (root) props.onOpenDiff(root, file.path);
                }}
              >
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
                {/* File path — basename bold, directory muted */}
                <span class="truncate text-fg-2 group-hover:text-fg">
                  <Show when={file.path.includes("/")} fallback={file.name}>
                    <span class="text-fg-3">
                      {file.path.slice(0, file.path.lastIndexOf("/") + 1)}
                    </span>
                    {file.name}
                  </Show>
                </span>
              </button>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
};

export default GitChanges;
