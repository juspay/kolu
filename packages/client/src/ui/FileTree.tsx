import {
  type Component,
  type JSX,
  createEffect,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";
import type { TreeNode } from "./buildFileTree";
import { collectDirPaths } from "./buildFileTree";

/** Generic collapsible file tree. Reusable across Code tab modes
 *  (changed-file list, file browser). */
export type FileTreeProps = {
  /** Root nodes of the tree. */
  nodes: TreeNode[];
  /** Currently selected file path (highlighted row). */
  selectedPath: string | null;
  /** Called when a file node is clicked. */
  onSelect: (path: string) => void;
  /** Optional render for the trailing badge (e.g. git status letter). */
  renderBadge?: (node: TreeNode) => JSX.Element;
  /** Optional async loader for directory children. When provided, directories
   *  start with empty children and load on first expand (file browser mode).
   *  When omitted, children are taken from the node (git-changes mode). */
  loadChildren?: (path: string) => Promise<TreeNode[]>;
};

const FileTree: Component<FileTreeProps> = (props) => {
  // Expand all directories by default when no loadChildren (git-changes mode);
  // start collapsed when loadChildren is set (file browser mode).
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  createEffect(
    on(
      () => props.nodes,
      (nodes) =>
        setExpanded(
          props.loadChildren ? new Set<string>() : collectDirPaths(nodes),
        ),
    ),
  );

  // Cache of lazily loaded children keyed by directory path.
  // Capped to prevent unbounded growth in large repos; oldest entries
  // are evicted first (Map preserves insertion order).
  const MAX_CACHE_ENTRIES = 200;
  const [childrenCache, setChildrenCache] = createSignal<
    Map<string, TreeNode[]>
  >(new Map());
  // Tracks directories currently being loaded.
  const [loading, setLoading] = createSignal<Set<string>>(new Set());

  const toggle = (path: string) => {
    const isExpanding = !expanded().has(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

    // Lazy-load children on first expand when loadChildren is provided.
    if (isExpanding && props.loadChildren && !childrenCache().has(path) && !loading().has(path)) {
      setLoading((prev) => new Set(prev).add(path));
      props.loadChildren(path).then(
        (children) => {
          setChildrenCache((prev) => {
          const next = new Map(prev).set(path, children);
          while (next.size > MAX_CACHE_ENTRIES) {
            next.delete(next.keys().next().value!);
          }
          return next;
        });
          setLoading((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
        },
        () => {
          // Clear loading state on failure so the user can retry by collapsing/expanding.
          setLoading((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
        },
      );
    }
  };

  return (
    <div data-testid="file-tree">
      <TreeLevel
        nodes={props.nodes}
        depth={0}
        expanded={expanded()}
        selectedPath={props.selectedPath}
        onToggle={toggle}
        onSelect={props.onSelect}
        renderBadge={props.renderBadge}
        childrenCache={childrenCache()}
        loading={loading()}
        loadChildren={props.loadChildren}
      />
    </div>
  );
};

type TreeLevelProps = {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  renderBadge?: (node: TreeNode) => JSX.Element;
  childrenCache: Map<string, TreeNode[]>;
  loading: Set<string>;
  loadChildren?: (path: string) => Promise<TreeNode[]>;
};

const TreeLevel: Component<TreeLevelProps> = (props) => (
  <For each={props.nodes}>
    {(node) => {
      const children = () => {
        if (node.kind !== "dir") return [];
        // In loadChildren mode, use cached children (or empty if not loaded yet).
        if (props.loadChildren) return props.childrenCache.get(node.path) ?? [];
        return node.children;
      };

      return (
        <>
          <button
            type="button"
            onClick={() =>
              node.kind === "dir"
                ? props.onToggle(node.path)
                : props.onSelect(node.path)
            }
            class="flex w-full items-center gap-1 px-2 py-0.5 text-left font-mono text-fg hover:bg-surface-2/40 cursor-pointer transition-colors"
            classList={{
              "bg-surface-2/50 border-l-2 border-accent":
                node.kind === "file" && props.selectedPath === node.path,
              "border-l-2 border-transparent": !(
                node.kind === "file" && props.selectedPath === node.path
              ),
            }}
            style={{ "padding-left": `${props.depth * 12 + 8}px` }}
            data-testid={
              node.kind === "dir" ? "file-tree-dir" : "diff-file-item"
            }
            data-path={node.path}
            data-active={
              node.kind === "file" && props.selectedPath === node.path
            }
          >
            <span class="w-3 shrink-0 text-center text-fg-3/50 text-[10px]">
              {node.kind === "dir"
                ? props.loading.has(node.path)
                  ? "\u2026"
                  : props.expanded.has(node.path)
                    ? "\u25BE"
                    : "\u25B8"
                : ""}
            </span>
            <span class="truncate min-w-0">
              {node.name}
              {node.kind === "dir" ? "/" : ""}
            </span>
            <Show when={props.renderBadge}>
              {(badge) => <span class="ml-auto shrink-0">{badge()(node)}</span>}
            </Show>
          </button>
          <Show when={node.kind === "dir" && props.expanded.has(node.path)}>
            <TreeLevel
              nodes={children()}
              depth={props.depth + 1}
              expanded={props.expanded}
              selectedPath={props.selectedPath}
              onToggle={props.onToggle}
              onSelect={props.onSelect}
              renderBadge={props.renderBadge}
              childrenCache={props.childrenCache}
              loading={props.loading}
              loadChildren={props.loadChildren}
            />
          </Show>
        </>
      );
    }}
  </For>
);

export default FileTree;
