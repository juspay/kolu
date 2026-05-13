/** Wrap a `<FileDiff>` or `<FileView>` from `@kolu/solid-pierre` with the
 *  kolu line-selection + right-click "Copy path[:line]" affordance. The
 *  `<CodeContextMenu>` portal is mounted as a sibling and triggered from
 *  the host div's `contextmenu` event; the `LineSelection` protocol is
 *  threaded into the inner viewer via the children render fn so the
 *  selection range stays in sync with what the menu offers. */

import type { SelectedLineRange } from "@kolu/solid-pierre";
import type { Component, JSX } from "solid-js";
import {
  CodeContextMenu,
  type CodeContextMenuController,
} from "../ui/CodeContextMenu";
import { type LineSelection, useLineSelection } from "../ui/useLineSelection";

export type CodeMenuFrameProps = {
  /** File path the line refs are anchored to — drives both the menu copy
   *  text and the line-selection effect that drops the range on file
   *  change. */
  path: string;
  /** Render the inner Pierre viewer. Pass `selection.handleSelect` to its
   *  `onLineSelected` prop so range updates reach the menu. */
  children: (selection: LineSelection) => JSX.Element;
  /** Externally-supplied initial range — seeds the line-selection
   *  controller so a terminal `path:line` click drives both the
   *  Pierre highlight AND the right-click menu's "Copy path:N" item. */
  initialSelectedLines?: SelectedLineRange | null;
  /** Forward selection changes to a parent (e.g. CodeTab's comments
   *  tray composer). Fires on every commit, including null. */
  onSelectionChange?: (range: SelectedLineRange | null) => void;
  /** When set, the context menu offers "Add comment on path:Lrange" —
   *  fires with the live range so the parent can enable comment mode. */
  onAddComment?: (range: SelectedLineRange) => void;
};

export const CodeMenuFrame: Component<CodeMenuFrameProps> = (props) => {
  let menuCtrl: CodeContextMenuController | undefined;
  // Only forward `onAddComment` when the parent actually supplied one —
  // `useLineSelection.buildItems` uses the option's truthiness as the
  // gate for emitting the "Add comment" menu entry.
  const selection = useLineSelection(() => props.path, {
    initialRange: () => props.initialSelectedLines,
    onChange: (range) => props.onSelectionChange?.(range),
    ...(props.onAddComment
      ? { onAddComment: (range) => props.onAddComment?.(range) }
      : {}),
  });
  return (
    <div
      // Attach contextmenu via addEventListener so the host div doesn't
      // carry interactive JSX props — the inner Pierre canvas is the
      // actual interactive surface; the host is layout only.
      ref={(el) => el.addEventListener("contextmenu", (e) => menuCtrl?.open(e))}
      class="flex flex-col h-full w-full"
    >
      {props.children(selection)}
      <CodeContextMenu
        getItems={selection.buildItems}
        ref={(c) => {
          menuCtrl = c;
        }}
      />
    </div>
  );
};

export default CodeMenuFrame;
