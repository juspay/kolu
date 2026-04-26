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
  type FileTreeInitialExpansion,
  type GitStatusEntry,
} from "@pierre/trees";
import type { FsWatchEvent, GitChangeStatus } from "kolu-common";
import { type Component, createEffect, on, onCleanup, onMount } from "solid-js";
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
  pathUpdate?: {
    seq: number;
    event: FsWatchEvent;
  };
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
};

type FileTreeBatchOperation = Parameters<FileTree["batch"]>[0][number];

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
  let fileSet = new Set(props.paths);

  function applyPathUpdate(event: FsWatchEvent): void {
    if (event.kind === "snapshot") {
      fileSet = new Set(event.paths);
      tree?.resetPaths(event.paths);
      return;
    }

    const operations: FileTreeBatchOperation[] = [];

    for (const move of event.moved ?? []) {
      if (!fileSet.has(move.from)) continue;
      fileSet.delete(move.from);
      fileSet.add(move.to);
      operations.push({ type: "move", from: move.from, to: move.to });
    }

    for (const removed of event.removed ?? []) {
      if (!fileSet.delete(removed)) continue;
      operations.push({ type: "remove", path: removed, recursive: true });
    }

    for (const added of event.added ?? []) {
      if (fileSet.has(added)) continue;
      fileSet.add(added);
      operations.push({ type: "add", path: added });
    }

    if (operations.length > 0) tree?.batch(operations);
  }

  onMount(() => {
    fileSet = new Set(props.paths);
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
        if (p !== null && !fileSet.has(p)) return; // ignore directories
        props.onSelect?.(p);
      },
    });
    tree.render({ containerWrapper: container });
  });

  createEffect(
    on(
      () => props.paths,
      (paths) => {
        if (props.pathUpdate) return;
        fileSet = new Set(paths);
        tree?.resetPaths(paths);
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.pathUpdate?.seq,
      () => {
        const update = props.pathUpdate;
        if (update) applyPathUpdate(update.event);
      },
      { defer: true },
    ),
  );

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
