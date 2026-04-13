/** FilesTab — lazy-loaded file tree browser using Ark UI TreeView. */

import {
  type Component,
  createSignal,
  createEffect,
  on,
  Show,
  For,
} from "solid-js";
import { TreeView, createTreeCollection } from "@ark-ui/solid/tree-view";
import type { TerminalMetadata, FsDirEntry } from "kolu-common";
import { client } from "../rpc/rpc";

interface FileNode {
  id: string;
  name: string;
  isDirectory: boolean;
  children?: FileNode[];
  childrenCount?: number;
}

function entryToNode(entry: FsDirEntry): FileNode {
  return {
    id: entry.path,
    name: entry.name,
    isDirectory: entry.isDirectory,
    // Directories might have children — signal to Ark UI for lazy loading.
    childrenCount: entry.isDirectory ? 1 : undefined,
  };
}

function buildRootCollection(entries: FsDirEntry[]) {
  return createTreeCollection<FileNode>({
    nodeToValue: (node) => node.id,
    nodeToString: (node) => node.name,
    rootNode: {
      id: "ROOT",
      name: "",
      isDirectory: true,
      children: entries.map(entryToNode),
    },
  });
}

/** Recursive tree node renderer. */
const TreeNode: Component<{ node: FileNode; indexPath: number[] }> = (
  props,
) => (
  <TreeView.NodeProvider node={props.node} indexPath={props.indexPath}>
    <Show
      when={props.node.isDirectory}
      fallback={
        <TreeView.Item class="flex items-center gap-1.5 py-0.5 px-2 text-[11px] text-fg-2 rounded hover:bg-surface-2/50 cursor-default select-none outline-none data-[selected]:bg-accent/10 data-[selected]:text-accent">
          <span class="w-3.5 text-center text-fg-3/50 shrink-0">
            <FileIcon />
          </span>
          <TreeView.ItemText class="truncate">
            {props.node.name}
          </TreeView.ItemText>
        </TreeView.Item>
      }
    >
      <TreeView.Branch>
        <TreeView.BranchControl class="flex items-center gap-1.5 py-0.5 px-2 text-[11px] text-fg-2 rounded hover:bg-surface-2/50 cursor-default select-none outline-none data-[selected]:bg-accent/10 data-[selected]:text-accent">
          <TreeView.BranchIndicator class="w-3.5 text-center text-fg-3/50 shrink-0 transition-transform data-[state=open]:rotate-90">
            <ChevronIcon />
          </TreeView.BranchIndicator>
          <span class="w-3.5 text-center text-fg-3/70 shrink-0">
            <FolderIcon />
          </span>
          <TreeView.BranchText class="truncate">
            {props.node.name}
          </TreeView.BranchText>
          <TreeView.NodeContext>
            {(ctx) => (
              <Show when={ctx().loading}>
                <span class="text-[9px] text-fg-3/40 ml-auto shrink-0">
                  ...
                </span>
              </Show>
            )}
          </TreeView.NodeContext>
        </TreeView.BranchControl>
        <TreeView.BranchContent class="pl-2">
          <For each={props.node.children}>
            {(child, i) => (
              <TreeNode node={child} indexPath={[...props.indexPath, i()]} />
            )}
          </For>
        </TreeView.BranchContent>
      </TreeView.Branch>
    </Show>
  </TreeView.NodeProvider>
);

/** Minimal SVG icons — inline to avoid extra dependencies. */
const ChevronIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" class="w-2.5 h-2.5 inline">
    <path
      d="M6 4l4 4-4 4"
      stroke="currentColor"
      stroke-width="1.5"
      fill="none"
    />
  </svg>
);

const FolderIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3 inline">
    <path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h3.18a1.5 1.5 0 0 1 1.06.44l.82.82a.5.5 0 0 0 .35.14H13A1.5 1.5 0 0 1 14.5 4.4v8.1A1.5 1.5 0 0 1 13 14H3A1.5 1.5 0 0 1 1.5 12.5V3z" />
  </svg>
);

const FileIcon = () => (
  <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3 inline">
    <path d="M3.5 1A1.5 1.5 0 0 0 2 2.5v11A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V5.621a1.5 1.5 0 0 0-.44-1.06L10.44 1.44A1.5 1.5 0 0 0 9.378 1H3.5z" />
  </svg>
);

const RefreshIcon = () => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    class="w-3 h-3"
  >
    <path d="M2.5 8a5.5 5.5 0 0 1 9.9-3.3M13.5 8a5.5 5.5 0 0 1-9.9 3.3" />
    <path d="M12 1.5v3.5h-3.5M4 11h3.5v3.5" />
  </svg>
);

const FilesTab: Component<{
  meta: TerminalMetadata | null;
  terminalId: string | undefined;
}> = (props) => {
  const [collection, setCollection] = createSignal<ReturnType<
    typeof createTreeCollection<FileNode>
  > | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const root = () => props.meta?.git?.repoRoot ?? props.meta?.cwd ?? null;

  async function loadRoot() {
    const terminalId = props.terminalId;
    const rootPath = root();
    if (!terminalId || !rootPath) return;

    setLoading(true);
    setError(null);
    try {
      const result = await client.fs.listDir({ terminalId, path: rootPath });
      setCollection(buildRootCollection(result.entries));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load directory");
    } finally {
      setLoading(false);
    }
  }

  async function loadChildren(details: {
    valuePath: string[];
  }): Promise<FileNode[]> {
    // Read terminalId at call time — not stale closure capture.
    const terminalId = props.terminalId;
    if (!terminalId) return [];

    const nodePath = details.valuePath[details.valuePath.length - 1];
    if (!nodePath) return [];

    const result = await client.fs.listDir({ terminalId, path: nodePath });
    return result.entries.map(entryToNode);
  }

  // Reload tree when terminal or root changes (e.g., switching terminals).
  createEffect(
    on(
      () => [props.terminalId, root()] as const,
      ([tid, r]) => {
        if (tid && r) {
          loadRoot();
        } else {
          setCollection(null);
          setError(null);
        }
      },
    ),
  );

  return (
    <div class="flex flex-col h-full" data-testid="files-tab">
      {/* Header with refresh button */}
      <div class="flex items-center justify-between px-3 py-1.5 border-b border-edge shrink-0">
        <span class="text-[9px] font-bold uppercase tracking-[0.15em] text-fg-3/60">
          {root() ? root()!.split("/").pop() : "Files"}
        </span>
        <button
          class="p-0.5 text-fg-3/50 hover:text-fg-2 transition-colors cursor-pointer disabled:opacity-30"
          onClick={loadRoot}
          disabled={loading() || !props.terminalId}
          aria-label="Refresh file tree"
          data-testid="files-refresh"
        >
          <RefreshIcon />
        </button>
      </div>

      {/* Content */}
      <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-1">
        <Show when={!props.terminalId}>
          <div class="flex items-center justify-center h-full text-fg-3/40 text-[11px]">
            No terminal selected
          </div>
        </Show>

        <Show when={props.terminalId}>
          <Show when={error()}>
            {(err) => (
              <div class="px-3 py-2 text-[11px] text-danger">{err()}</div>
            )}
          </Show>

          <Show when={loading() && !collection()}>
            <div class="flex items-center justify-center h-full text-fg-3/40 text-[11px]">
              Loading...
            </div>
          </Show>

          <Show when={collection()}>
            {(coll) => (
              <TreeView.Root
                collection={coll()}
                loadChildren={loadChildren}
                onLoadChildrenComplete={(e) => setCollection(e.collection)}
              >
                <TreeView.Tree class="text-[11px]">
                  <For each={coll().rootNode.children}>
                    {(node, i) => <TreeNode node={node} indexPath={[i()]} />}
                  </For>
                </TreeView.Tree>
              </TreeView.Root>
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default FilesTab;
