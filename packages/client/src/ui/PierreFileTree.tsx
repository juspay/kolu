/** Thin SolidJS wrapper over `@pierre/trees`' vanilla `FileTree` class.
 *
 *  Pierre's `FileTree` owns its DOM (shadow-root rendered). We mount once,
 *  push updates via the class's setters (resetPaths, setGitStatus) inside
 *  reactive effects, and call `cleanUp()` on disposal. No re-render loop —
 *  SolidJS reactivity just tickles imperative setters. */

import { type Component, createEffect, on, onCleanup, onMount } from "solid-js";
import { FileTree, type GitStatusEntry } from "@pierre/trees";
import type { GitChangeStatus } from "kolu-common";
import { pierreTreesStyle } from "./pierreTheme";

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

  onMount(() => {
    tree = new FileTree({
      paths: props.paths,
      initialExpansion: "closed",
      search: props.search ?? true,
      gitStatus: props.gitStatus,
      initialSelectedPaths: props.selectedPath ? [props.selectedPath] : [],
      onSelectionChange: (paths) => {
        // Pierre fires with all selected paths; we model single-select.
        props.onSelect?.(paths[0] ?? null);
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

  onCleanup(() => tree?.cleanUp());

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
