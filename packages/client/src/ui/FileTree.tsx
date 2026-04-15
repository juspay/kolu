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
 *  (changed-file list, future file browser). */
export type FileTreeProps = {
  /** Root nodes of the tree. */
  nodes: TreeNode[];
  /** Currently selected file path (highlighted row). */
  selectedPath: string | null;
  /** Called when a file node is clicked. */
  onSelect: (path: string) => void;
  /** Optional render for the trailing badge (e.g. git status letter). */
  renderBadge?: (node: TreeNode) => JSX.Element;
};

const FileTree: Component<FileTreeProps> = (props) => {
  // Expand all directories by default; rebuild when the tree changes.
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  createEffect(
    on(
      () => props.nodes,
      (nodes) => setExpanded(collectDirPaths(nodes)),
    ),
  );

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
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
};

const TreeLevel: Component<TreeLevelProps> = (props) => (
  <For each={props.nodes}>
    {(node) => (
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
          data-testid={node.kind === "dir" ? "file-tree-dir" : "diff-file-item"}
          data-path={node.path}
          data-active={node.kind === "file" && props.selectedPath === node.path}
        >
          <span class="w-3 shrink-0 text-center text-fg-3/50 text-[10px]">
            {node.kind === "dir"
              ? props.expanded.has(node.path)
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
            nodes={node.kind === "dir" ? node.children : []}
            depth={props.depth + 1}
            expanded={props.expanded}
            selectedPath={props.selectedPath}
            onToggle={props.onToggle}
            onSelect={props.onSelect}
            renderBadge={props.renderBadge}
          />
        </Show>
      </>
    )}
  </For>
);

export default FileTree;
