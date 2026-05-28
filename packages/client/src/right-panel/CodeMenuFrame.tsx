/** Wrap a `<CodeView>` from `@kolu/solid-pierre` with the kolu line-selection
 *  + right-click "Copy path[:line]" affordance. The `<CodeContextMenu>`
 *  portal is mounted as a sibling and triggered from the host div's
 *  `contextmenu` event; the `LineSelection` protocol is threaded into the
 *  inner viewer via the children render fn so the selection range stays in
 *  sync with what the menu offers. */

import type { SelectedLineRange } from "@kolu/solid-pierre";
import type { Component, JSX } from "solid-js";
import {
  CodeContextMenu,
  type CodeContextMenuController,
} from "../ui/CodeContextMenu";
import type { LineRef } from "@kolu/file-line-ref";
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
  /** When provided, adds an "Open <path>:<line>" entry to the context
   *  menu that dispatches the selected ref to the host (typically a
   *  call to `openInCodeTab`). Omit for viewers where "open" is a
   *  no-op (the file is already on screen at line precision). */
  onOpen?: (ref: LineRef) => void;
};

/** Walk the contextmenu event's composed path (which pierces Pierre's
 *  open shadow DOM, where `event.target` would otherwise be retargeted
 *  to the shadow host) and return the line number from the first
 *  element carrying `data-column-number`. Returns null when the
 *  right-click landed outside any gutter line — empty area, scrollbar,
 *  decoration row — so the host can skip opening a menu entirely. */
function lineFromContextMenu(event: MouseEvent): number | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue;
    const raw = node.getAttribute("data-column-number");
    if (raw === null) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  return null;
}

export const CodeMenuFrame: Component<CodeMenuFrameProps> = (props) => {
  let menuCtrl: CodeContextMenuController | undefined;
  const selection = useLineSelection(() => props.path, {
    initialRange: () => props.initialSelectedLines,
    onOpen: () => props.onOpen,
  });
  return (
    <div
      // Attach contextmenu via addEventListener so the host div doesn't
      // carry interactive JSX props — the inner Pierre canvas is the
      // actual interactive surface; the host is layout only.
      ref={(el) =>
        el.addEventListener("contextmenu", (e) => {
          // Right-click on a gutter line is the single entry point for
          // the context menu: it both selects the line and opens the
          // menu in one gesture. Right-clicks elsewhere (whitespace,
          // scrollbar, decoration row) clear the range and produce no
          // menu — `buildItems` returns empty when no range is set,
          // so `menuCtrl.open` short-circuits without preventing the
          // browser default.
          const line = lineFromContextMenu(e);
          selection.handleSelect(
            line === null ? null : { start: line, end: line },
          );
          menuCtrl?.open(e);
        })
      }
      class="h-full w-full"
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
