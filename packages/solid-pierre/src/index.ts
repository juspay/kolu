/** `@kolu/solid-pierre` — Solid-native wrappers over `@pierre/trees` and
 *  `@pierre/diffs`. Encapsulates the imperative mount/render/cleanUp dance
 *  and routes Pierre throws through a required `onError` prop so silent
 *  failures can't escape into a blank pane. */

export type {
  CodeViewItem,
  CodeViewLineSelection,
  SelectedLineRange,
} from "@pierre/diffs";
// Re-export Pierre types consumers commonly need to type prop callbacks
// without reaching into `@pierre/*` directly.
export type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTreeIconConfig,
  FileTreeInitialExpansion,
  GitStatusEntry,
} from "@pierre/trees";
export type { CodeViewProps } from "./CodeView";
export { CodeView } from "./CodeView";
export { diffItem, fileItem } from "./codeViewItem";
export type { FileTreeProps } from "./FileTree";
export { FileTree } from "./FileTree";
export { useCodeViewSelection } from "./useCodeViewSelection";
