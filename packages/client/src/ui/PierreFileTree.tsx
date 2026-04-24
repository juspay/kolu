/** Thin SolidJS wrapper over `@pierre/trees`' vanilla `FileTree` class.
 *
 *  Pierre's `FileTree` owns its DOM (shadow-root rendered). We mount once,
 *  push updates via the class's setters (resetPaths, setGitStatus) inside
 *  reactive effects, and call `cleanUp()` on disposal. No re-render loop —
 *  SolidJS reactivity just tickles imperative setters. */

import {
  type Component,
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { FileTree, type GitStatusEntry } from "@pierre/trees";
import type { GitChangeStatus } from "kolu-common";
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
};

const PierreFileTree: Component<PierreFileTreeProps> = (props) => {
  let container!: HTMLDivElement;
  let tree: FileTree | undefined;

  // Pierre emits onSelectionChange for directory clicks too — which would
  // trigger a file read and crash with EISDIR. Directories don't appear in
  // `paths` (Pierre infers them from path prefixes), so membership in this
  // set is a reliable file-vs-folder discriminator.
  const fileSet = createMemo(() => new Set(props.paths));

  // Pierre clears the search query whenever the input blurs (clicking a row
  // steals focus → query gone). Their `searchBlurBehavior: 'retain'` only
  // protects the *initial* mount query, not user-typed queries. We work
  // around it: track the live query, and when a row click closes the search,
  // re-open it with the saved query. Escape / explicit clear still close
  // because they aren't followed by a selection.
  let liveQuery = "";
  let pendingRestore: number | undefined;
  const RESTORE_WINDOW_MS = 120;

  onMount(() => {
    tree = new FileTree({
      paths: props.paths,
      initialExpansion: "closed",
      icons: pierreIconConfig,
      search: props.search ?? true,
      gitStatus: props.gitStatus,
      initialSelectedPaths: props.selectedPath ? [props.selectedPath] : [],
      onSearchChange: (value) => {
        if (value !== null) {
          liveQuery = value;
          if (pendingRestore !== undefined) {
            clearTimeout(pendingRestore);
            pendingRestore = undefined;
          }
          return;
        }
        if (!liveQuery) return;
        // Session closed; wait briefly to see if a selection follows. If so,
        // we treat the close as a side-effect of the row click and restore.
        // If no selection arrives in the window, the user pressed Escape (or
        // similar) and we let the close stand.
        pendingRestore = window.setTimeout(() => {
          pendingRestore = undefined;
          liveQuery = "";
        }, RESTORE_WINDOW_MS);
      },
      onSelectionChange: (paths) => {
        // Pierre fires with all selected paths; we model single-select.
        const p = paths[0] ?? null;
        if (p !== null && !fileSet().has(p)) return; // ignore directories
        props.onSelect?.(p);
        if (pendingRestore !== undefined) {
          clearTimeout(pendingRestore);
          pendingRestore = undefined;
          if (liveQuery) {
            const q = liveQuery;
            queueMicrotask(() => tree?.openSearch(q));
          }
        }
      },
    });
    tree.render({ containerWrapper: container });
  });

  createEffect(
    on(
      () => props.paths,
      (paths) => tree?.resetPaths(paths),
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

  onCleanup(() => {
    if (pendingRestore !== undefined) clearTimeout(pendingRestore);
    tree?.cleanUp();
  });

  return (
    <div
      ref={container!}
      class="h-full w-full"
      style={pierreTreesStyle}
      data-testid="pierre-file-tree"
    />
  );
};

export default PierreFileTree;
