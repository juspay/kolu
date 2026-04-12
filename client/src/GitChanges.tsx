/**
 * Git changes view — lists modified/added/deleted files in the workspace
 * and shows inline diffs when expanded. Lives in the sidebar "Changes" tab.
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
import { gitStatusBgColor } from "./gitStatusColor";
import type {
  FsSearchResult,
  FsFileDiffOutput,
  DiffHunk,
  DiffLine,
} from "kolu-common";
import { match } from "ts-pattern";

/** Inline diff view for a single file. */
const DiffView: Component<{
  root: string;
  filePath: string;
}> = (props) => {
  const [diff, setDiff] = createSignal<FsFileDiffOutput | null>(null);
  const [loading, setLoading] = createSignal(true);

  createEffect(
    on(
      () => [props.root, props.filePath] as const,
      ([root, filePath]) => {
        setLoading(true);
        setDiff(null);
        void client.fs
          .fileDiff({ root, filePath })
          .then(setDiff)
          .catch(() => {})
          .finally(() => setLoading(false));
      },
    ),
  );

  return (
    <div class="border-t border-edge/50 bg-surface-0">
      <Show
        when={!loading()}
        fallback={
          <div class="px-3 py-1 text-[0.65rem] text-fg-3">Loading diff...</div>
        }
      >
        <Show
          when={diff()?.hunks.length}
          fallback={
            <div class="px-3 py-1 text-[0.65rem] text-fg-3 italic">
              No changes
            </div>
          }
        >
          <For each={diff()!.hunks}>{(hunk) => <HunkView hunk={hunk} />}</For>
        </Show>
      </Show>
    </div>
  );
};

/** Renders a single diff hunk with add/remove/context lines. */
const HunkView: Component<{ hunk: DiffHunk }> = (props) => (
  <div class="font-mono text-[0.65rem] leading-4">
    {/* Hunk header */}
    <div class="px-2 py-0.5 text-fg-3 bg-surface-1/50 select-none">
      @@ -{props.hunk.oldStart},{props.hunk.oldCount} +{props.hunk.newStart},
      {props.hunk.newCount} @@
    </div>
    <For each={props.hunk.lines}>
      {(line) => {
        const style = match(line.kind)
          .with("add", () => ({
            bg: "bg-green-500/10",
            marker: "+",
            markerColor: "text-green-400",
          }))
          .with("remove", () => ({
            bg: "bg-red-500/10",
            marker: "-",
            markerColor: "text-red-400",
          }))
          .with("context", () => ({
            bg: "",
            marker: " ",
            markerColor: "text-fg-3",
          }))
          .exhaustive();
        return (
          <div class={`flex ${style.bg}`}>
            <span class="shrink-0 w-4 text-right pr-1 text-fg-3 select-none">
              {line.oldLine ?? ""}
            </span>
            <span class="shrink-0 w-4 text-right pr-1 text-fg-3 select-none">
              {line.newLine ?? ""}
            </span>
            <span
              class={`shrink-0 w-3 text-center select-none ${style.markerColor}`}
            >
              {style.marker}
            </span>
            <span class="whitespace-pre overflow-hidden text-fg-2">
              {line.content || " "}
            </span>
          </div>
        );
      }}
    </For>
  </div>
);

/** Status label for display. */
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
  onOpenFile: (root: string, filePath: string) => void;
}> = (props) => {
  const [changedFiles, setChangedFiles] = createSignal<FsSearchResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [expandedFile, setExpandedFile] = createSignal<string | null>(null);

  // Fetch changed files when root changes
  createEffect(
    on(props.root, (root) => {
      setChangedFiles([]);
      setExpandedFile(null);
      if (!root) return;
      setLoading(true);
      void client.fs
        .search({ root, query: "", limit: 500 })
        .then((results) => {
          // Filter to only files with git status (i.e. changed files)
          setChangedFiles(results.filter((f) => f.gitStatus !== null));
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }),
  );

  function toggleDiff(path: string) {
    setExpandedFile((current) => (current === path ? null : path));
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
          <div class="px-3 py-1.5 text-[0.65rem] text-fg-3 font-medium uppercase tracking-wider">
            {changedFiles().length} changed{" "}
            {changedFiles().length === 1 ? "file" : "files"}
          </div>
          <For each={changedFiles()}>
            {(file) => (
              <div>
                <button
                  class="flex items-center gap-1.5 w-full text-left px-2 py-1 text-xs hover:bg-surface-2 transition-colors group"
                  onClick={() => toggleDiff(file.path)}
                >
                  {/* Expand chevron */}
                  <svg
                    class="w-2.5 h-2.5 text-fg-3 shrink-0 transition-transform"
                    classList={{
                      "rotate-90": expandedFile() === file.path,
                    }}
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M4 2l4 4-4 4" />
                  </svg>
                  {/* Status badge */}
                  <span
                    class={`shrink-0 text-[0.6rem] font-bold w-3 text-center ${STATUS_COLOR[file.gitStatus!] ?? "text-fg-3"}`}
                  >
                    {STATUS_LABEL[file.gitStatus!] ?? "?"}
                  </span>
                  {/* File name (just the basename, with dir in muted) */}
                  <span class="truncate text-fg-2 group-hover:text-fg">
                    <Show when={file.path.includes("/")} fallback={file.name}>
                      <span class="text-fg-3">
                        {file.path.slice(0, file.path.lastIndexOf("/") + 1)}
                      </span>
                      {file.name}
                    </Show>
                  </span>
                </button>
                {/* Inline diff — shown when expanded */}
                <Show when={expandedFile() === file.path && props.root()}>
                  <DiffView root={props.root()!} filePath={file.path} />
                </Show>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
};

export default GitChanges;
