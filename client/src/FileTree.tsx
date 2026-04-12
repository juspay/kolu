/**
 * File tree — collapsible sidebar section showing the workspace file hierarchy.
 * Fetches directory contents lazily on expand. Git status decorations on entries.
 * Expand/collapse state is ephemeral — no persistence.
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
import { client } from "./rpc";
import { gitStatusBgColor } from "./gitStatusColor";
import type { FileEntry } from "kolu-common";

interface DirState {
  entries: FileEntry[];
  loading: boolean;
}

const FileTreeEntry: Component<{
  entry: FileEntry;
  root: string;
  depth: number;
  expanded: Record<string, DirState | undefined>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}> = (props) => {
  const isDir = () => props.entry.kind === "directory";
  const isExpanded = () => !!props.expanded[props.entry.path];
  const dirState = () => props.expanded[props.entry.path];

  return (
    <>
      <button
        class="flex items-center gap-1 w-full text-left px-2 py-0.5 text-xs hover:bg-surface-2 transition-colors group"
        style={{ "padding-left": `${props.depth * 12 + 8}px` }}
        onClick={() =>
          isDir()
            ? props.onToggle(props.entry.path)
            : props.onOpenFile(props.entry.path)
        }
      >
        {/* Expand/collapse chevron for directories */}
        <Show when={isDir()} fallback={<span class="w-3 shrink-0" />}>
          <svg
            class="w-3 h-3 text-fg-3 shrink-0 transition-transform"
            classList={{ "rotate-90": isExpanded() }}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M4 2l4 4-4 4" />
          </svg>
        </Show>
        {/* Icon */}
        <Show
          when={isDir()}
          fallback={
            <svg
              class="w-3.5 h-3.5 text-fg-3 shrink-0"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path
                d="M4 1h8a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z"
                opacity="0.5"
              />
            </svg>
          }
        >
          <svg
            class="w-3.5 h-3.5 text-fg-3 shrink-0"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path
              d="M1 3h5l2 2h7v9a1 1 0 01-1 1H2a1 1 0 01-1-1V3z"
              opacity="0.5"
            />
          </svg>
        </Show>
        {/* Name */}
        <span class="truncate text-fg-2 group-hover:text-fg">
          {props.entry.name}
        </span>
        {/* Git status dot */}
        <Show when={props.entry.gitStatus}>
          {(status) => (
            <span
              class={`shrink-0 w-1.5 h-1.5 rounded-full ml-auto ${gitStatusBgColor[status()] ?? ""}`}
              title={status()}
            />
          )}
        </Show>
      </button>
      {/* Expanded children */}
      <Show when={isDir() && isExpanded() && dirState()}>
        {(state) => (
          <Show
            when={!state().loading}
            fallback={
              <div
                class="text-[0.65rem] text-fg-3 py-0.5"
                style={{ "padding-left": `${(props.depth + 1) * 12 + 8}px` }}
              >
                Loading...
              </div>
            }
          >
            <For each={state().entries}>
              {(child) => (
                <FileTreeEntry
                  entry={child}
                  root={props.root}
                  depth={props.depth + 1}
                  expanded={props.expanded}
                  onToggle={props.onToggle}
                  onOpenFile={props.onOpenFile}
                />
              )}
            </For>
            <Show when={state().entries.length === 0}>
              <div
                class="text-[0.65rem] text-fg-3 italic py-0.5"
                style={{
                  "padding-left": `${(props.depth + 1) * 12 + 8}px`,
                }}
              >
                Empty
              </div>
            </Show>
          </Show>
        )}
      </Show>
    </>
  );
};

const FileTree: Component<{
  root: Accessor<string | null>;
  onOpenFile: (root: string, filePath: string) => void;
}> = (props) => {
  const [expanded, setExpanded] = createStore<
    Record<string, DirState | undefined>
  >({});
  const [rootEntries, setRootEntries] = createSignal<FileEntry[]>([]);
  const [loading, setLoading] = createSignal(false);

  // Fetch root directory when root changes
  createEffect(
    on(props.root, (root) => {
      setRootEntries([]);
      // Clear expanded state when root changes
      setExpanded({});
      if (!root) return;
      setLoading(true);
      void client.fs
        .listDir({ root, dirPath: "" })
        .then(setRootEntries)
        .catch(() => {
          // Best-effort: root listing fails if workspace is removed while tree is open
        })
        .finally(() => setLoading(false));
    }),
  );

  function handleToggle(path: string) {
    const currentRoot = props.root();
    if (!currentRoot) return;

    if (expanded[path]) {
      // Collapse
      setExpanded(
        produce((state) => {
          delete state[path];
        }),
      );
    } else {
      // Expand — fetch contents
      setExpanded(path, { entries: [], loading: true });
      void client.fs
        .listDir({ root: currentRoot, dirPath: path })
        .then((entries) => {
          setExpanded(path, { entries, loading: false });
        })
        .catch(() => {
          setExpanded(path, { entries: [], loading: false });
        });
    }
  }

  return (
    <div class="py-1">
      <Show
        when={!loading()}
        fallback={
          <div class="px-3 py-2 text-xs text-fg-3">Loading files...</div>
        }
      >
        <Show
          when={rootEntries().length > 0}
          fallback={
            <Show when={props.root()}>
              <div class="px-3 py-2 text-xs text-fg-3 italic">
                No files found
              </div>
            </Show>
          }
        >
          <For each={rootEntries()}>
            {(entry) => (
              <FileTreeEntry
                entry={entry}
                root={props.root()!}
                depth={0}
                expanded={expanded}
                onToggle={handleToggle}
                onOpenFile={(path) => props.onOpenFile(props.root()!, path)}
              />
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
};

export default FileTree;
