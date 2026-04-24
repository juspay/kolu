/** Shared line-selection + line-ref-menu wiring for Pierre's file and diff
 *  viewers (`@pierre/diffs`). Both renderers expose `enableLineSelection` +
 *  `onLineSelected`, both surface a context menu offering "Copy path" plus
 *  "Copy <path>:<line>" when a line is selected, and both must drop the
 *  selection when the displayed file changes. Centralizing the protocol
 *  here means new menu entries are a single edit.
 *
 *  Usage:
 *    const sel = useLineSelection(() => props.path);
 *    // wire `sel.handleSelect` into Pierre's `onLineSelected`
 *    // wire `sel.buildItems` into `<CodeContextMenu getItems=...>`
 */

import { createEffect, createSignal, on, type Accessor } from "solid-js";
import type { SelectedLineRange } from "@pierre/diffs";
import type { CodeContextMenuItem } from "./CodeContextMenu";
import { formatLineRef } from "./lineRef";

export type LineSelection = {
  /** Bind to Pierre's `onLineSelected` — the renderer fires this on every
   *  selection commit (single-line click or drag end). */
  handleSelect: (range: SelectedLineRange | null) => void;
  /** Bind to `<CodeContextMenu getItems>`. Returns "Copy path" plus, when
   *  a line is selected, "Copy <path>:<line>" with the rendered ref. */
  buildItems: () => CodeContextMenuItem[];
};

export function useLineSelection(path: Accessor<string>): LineSelection {
  const [range, setRange] = createSignal<SelectedLineRange | null>(null);

  // A new file replaces the old selection scope — drop it so a stale
  // "Copy path:N" menu entry from the previous file can't surface.
  createEffect(on(path, () => setRange(null), { defer: true }));

  return {
    handleSelect: (r) => setRange(r),
    buildItems: () => {
      const items: CodeContextMenuItem[] = [
        { label: "Copy path", textToCopy: path() },
      ];
      const r = range();
      if (r) {
        const ref = formatLineRef(path(), r.start, r.end);
        items.push({ label: `Copy ${ref}`, textToCopy: ref });
      }
      return items;
    },
  };
}
