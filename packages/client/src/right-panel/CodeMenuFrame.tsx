import { codeViewItemIdAt, type SelectedLineRange } from "@kolu/solid-pierre";
import type { Component, JSX } from "solid-js";
import {
  CodeContextMenu,
  type CodeContextMenuController,
} from "../ui/CodeContextMenu";
import type { LineRef } from "../ui/lineRef";
import { type LineSelection, useLineSelection } from "../ui/useLineSelection";

export type CodeMenuFrameProps = {
  path: string;
  children: (selection: LineSelection) => JSX.Element;
  initialSelectedLines?: SelectedLineRange | null;
  onOpen?: (ref: LineRef) => void;
};

function lineFromComposedPath(event: MouseEvent): number | null {
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
      ref={(el) =>
        el.addEventListener("contextmenu", (e) => {
          const line = lineFromComposedPath(e);
          const [target] = e.composedPath();
          selection.handleSelect(
            line === null ? null : { start: line, end: line },
            target instanceof Node ? codeViewItemIdAt(target) : undefined,
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
