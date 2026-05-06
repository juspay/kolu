/** `@kolu/solid-pierre` — Solid-native wrappers over `@pierre/trees` and
 *  `@pierre/diffs`. Encapsulates the imperative mount/render/cleanUp dance
 *  and routes Pierre throws through a required `onError` prop so silent
 *  failures can't escape into a blank pane. */

export { FileTree } from "./FileTree";
export type { FileTreeProps } from "./FileTree";
export { FileDiff } from "./FileDiff";
export type { FileDiffProps } from "./FileDiff";
export { FileView } from "./FileView";
export type { FileViewProps } from "./FileView";
export { Virtualizer, useVirtualizer } from "./Virtualizer";
export type { VirtualizerProps } from "./Virtualizer";

// Re-export Pierre types consumers commonly need to type prop callbacks
// without reaching into `@pierre/*` directly.
export type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTreeIconConfig,
  FileTreeInitialExpansion,
  GitStatusEntry,
} from "@pierre/trees";
export type { SelectedLineRange, VirtualizerConfig } from "@pierre/diffs";
