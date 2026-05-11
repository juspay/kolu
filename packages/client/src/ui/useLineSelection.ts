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

import type { SelectedLineRange } from "@pierre/diffs";
import { type Accessor, createEffect, createSignal, on } from "solid-js";
import type { CodeContextMenuItem } from "./CodeContextMenu";
import { formatLineRef } from "./lineRef";

export type LineSelection = {
  /** Current selection range — bind to Pierre's `selectedLines` prop
   *  so the visual highlight tracks the controller. */
  range: Accessor<SelectedLineRange | null>;
  /** Bind to Pierre's `onLineSelected` — the renderer fires this on every
   *  selection commit (single-line click or drag end). */
  handleSelect: (range: SelectedLineRange | null) => void;
  /** Bind to `<CodeContextMenu getItems>`. Returns "Copy path" plus, when
   *  a line is selected, "Copy <path>:<line>" with the rendered ref. */
  buildItems: () => CodeContextMenuItem[];
};

export interface LineSelectionOptions {
  /** Externally-driven initial range — caller updates this when a new
   *  navigation request lands (e.g. terminal `path:line` click). The
   *  effect below pushes it into the controller's range, which means
   *  the right-click menu and the Pierre highlight stay in sync. */
  initialRange?: Accessor<SelectedLineRange | null | undefined>;
}

export function useLineSelection(
  path: Accessor<string>,
  options: LineSelectionOptions = {},
): LineSelection {
  const [range, setRange] = createSignal<SelectedLineRange | null>(
    options.initialRange?.() ?? null,
  );

  // Reseed the controller on either trigger — a new file replaces the
  // selection scope (a stale "Copy path:N" entry must not survive),
  // and an external request ticks `initialRange` with the new target.
  // Both seed from the same source, so one effect with a combined
  // dep tuple suffices.
  createEffect(
    on(
      () => [path(), options.initialRange?.() ?? null] as const,
      ([, initial]) => setRange(initial),
      { defer: true },
    ),
  );

  return {
    range,
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
