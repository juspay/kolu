/** Thin SolidJS wrapper over `@pierre/trees`' vanilla `FileTree` class.
 *
 *  Pierre's `FileTree` owns its DOM (shadow-root rendered). We mount once,
 *  push updates via the class's setters (resetPaths, setGitStatus) inside
 *  reactive effects, and call `cleanUp()` on disposal. No re-render loop —
 *  SolidJS reactivity just tickles imperative setters. */

import {
  type ContextMenuItem,
  type ContextMenuOpenContext,
  FileTree,
  type FileTreeBatchOperation,
  type FileTreeInitialExpansion,
  type GitStatusEntry,
} from "@pierre/trees";
import type { FsWatchEvent, GitChangeStatus } from "kolu-common";
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { match } from "ts-pattern";
import { toast } from "solid-sonner";
import { pierreIconConfig, pierreTreesStyle } from "./pierreTheme";

/** Map Kolu's single-letter porcelain status to Pierre's word form. */
const GIT_STATUS_WORD: Record<GitChangeStatus, GitStatusEntry["status"]> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "renamed",
  U: "modified",
  T: "modified",
  "?": "untracked",
};

export function toGitStatusEntries(
  files: { path: string; status: GitChangeStatus }[],
): GitStatusEntry[] {
  return files.map((f) => ({
    path: f.path,
    status: GIT_STATUS_WORD[f.status],
  }));
}

export type PierreFileTreeProps = {
  paths: string[];
  gitStatus?: GitStatusEntry[];
  selectedPath?: string | null;
  onSelect?: (path: string | null) => void;
  /** Enable the search affordance inside the tree header. */
  search?: boolean;
  /** Initial folder expansion — captured at construction and **not
   *  reactive**. Pierre takes this once in the `FileTree` constructor;
   *  later prop changes are silently ignored. Re-mount the component
   *  (e.g. by toggling its parent `<Show when>`) to apply a new value.
   *  Defaults to "closed" (full repo can be huge); pass "open" for
   *  change-set views where every entry should be visible without
   *  clicking. */
  initialExpansion?: FileTreeInitialExpansion;
  /** Optional live event stream from `stream.fsWatch`. When provided,
   *  the tree is updated incrementally — `snapshot` events go through
   *  `resetPaths`, `delta` events through `batch([{type:'add'|'remove'}])`.
   *  In this mode, the `paths` prop is only consulted at mount time
   *  (as a placeholder until the first snapshot lands); subsequent
   *  changes to `paths` are ignored — the event stream is the source
   *  of truth. Without this prop, the tree falls back to driving
   *  `resetPaths` on every `paths` change (the static-list mode used
   *  for the diff/branch views, where `git.status` provides the list). */
  event?: Accessor<FsWatchEvent | undefined>;
};

/** Build the Pierre right-click menu. Pierre wants an `HTMLElement` (not a
 *  Solid component) since the menu lives inside the tree's shadow DOM.
 *
 *  Pierre wraps the rendered element in a `display:flex; align-items:center`
 *  anchor positioned at the cursor — letting our menu lay out normally
 *  inside that wrapper shifts it off the click point. We pin `position:
 *  fixed` with `context.anchorRect` coords so the menu lands at the
 *  cursor regardless of the wrapper's layout. */
function renderContextMenu(
  item: ContextMenuItem,
  context: ContextMenuOpenContext,
): HTMLElement {
  const menu = document.createElement("div");
  menu.style.cssText = [
    `position:fixed`,
    `left:${context.anchorRect.left}px`,
    `top:${context.anchorRect.top}px`,
    "background:var(--color-surface-1)",
    "border:1px solid var(--color-edge)",
    "border-radius:6px",
    "padding:4px",
    "min-width:160px",
    "box-shadow:0 6px 20px rgba(0,0,0,0.35)",
    "font-size:11px",
    "color:var(--color-fg)",
  ].join(";");

  const addItem = (label: string, onClick: () => void) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.style.cssText = [
      "display:block",
      "width:100%",
      "text-align:left",
      "padding:4px 8px",
      "border:0",
      "background:transparent",
      "color:inherit",
      "cursor:pointer",
      "border-radius:4px",
      "font:inherit",
    ].join(";");
    btn.addEventListener(
      "mouseenter",
      () => (btn.style.background = "var(--color-surface-2)"),
    );
    btn.addEventListener(
      "mouseleave",
      () => (btn.style.background = "transparent"),
    );
    btn.addEventListener("click", () => {
      onClick();
      context.close();
    });
    menu.appendChild(btn);
  };

  addItem("Copy path", () => {
    navigator.clipboard
      .writeText(item.path)
      .then(() => toast.success(`Copied: ${item.path}`))
      .catch((err: Error) => toast.error(`Failed to copy: ${err.message}`));
  });

  return menu;
}

const PierreFileTree: Component<PierreFileTreeProps> = (props) => {
  let container!: HTMLDivElement;
  let tree: FileTree | undefined;

  // Pierre emits onSelectionChange for directory clicks too — which would
  // trigger a file read and crash with EISDIR. Directories don't appear in
  // `paths` (Pierre infers them from path prefixes), so membership in this
  // set is a reliable file-vs-folder discriminator.
  const fileSet = createMemo(() => new Set(props.paths));

  onMount(() => {
    tree = new FileTree({
      paths: props.paths,
      initialExpansion: props.initialExpansion ?? "closed",
      // Collapse single-child directory chains (e.g. `packages/client/src` →
      // one row) so deep monorepo paths don't eat half the panel width.
      flattenEmptyDirectories: true,
      // Pin parent directory headers to the top of the scroll viewport so
      // context survives long subtrees.
      stickyFolders: true,
      icons: pierreIconConfig,
      search: props.search ?? true,
      gitStatus: props.gitStatus,
      initialSelectedPaths: props.selectedPath ? [props.selectedPath] : [],
      composition: {
        contextMenu: {
          enabled: true,
          triggerMode: "both",
          render: renderContextMenu,
        },
      },
      onSelectionChange: (paths) => {
        // Pierre fires with all selected paths; we model single-select.
        const p = paths[0] ?? null;
        if (p !== null && !fileSet().has(p)) return; // ignore directories
        props.onSelect?.(p);
      },
    });
    tree.render({ containerWrapper: container });
  });

  // Branch reactivity on whether the consumer drives updates via an event
  // stream or via a static `paths` array. `props.event` is sampled
  // untracked here — it's a structural prop that doesn't change identity
  // across the component's lifetime (CodeTab decides at mount what mode
  // it's in). The branch lives inside `createEffect` so the active path
  // sees its own dependencies tracked normally.
  createEffect(() => {
    if (props.event) {
      const ev = props.event();
      if (!ev || !tree) return;
      match(ev)
        .with({ kind: "snapshot" }, ({ paths }) => tree?.resetPaths(paths))
        .with({ kind: "delta" }, ({ added, removed }) => {
          const ops: FileTreeBatchOperation[] = [
            ...removed.map(
              (path): FileTreeBatchOperation => ({ type: "remove", path }),
            ),
            ...added.map(
              (path): FileTreeBatchOperation => ({ type: "add", path }),
            ),
          ];
          if (ops.length > 0) tree?.batch(ops);
        })
        .exhaustive();
    } else {
      // Static-list mode: `paths` is the source of truth.
      tree?.resetPaths(props.paths);
    }
  });

  createEffect(
    on(
      () => props.gitStatus,
      (g) => tree?.setGitStatus(g),
      { defer: true },
    ),
  );

  onCleanup(() => tree?.cleanUp());

  return (
    <div
      ref={container}
      class="h-full w-full"
      style={pierreTreesStyle}
      data-testid="pierre-file-tree"
    />
  );
};

export default PierreFileTree;
