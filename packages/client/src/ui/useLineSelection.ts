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
  /** Synchronous outbound callback fired on every range change — user
   *  drags, programmatic seeds via `initialRange`, file-switch resets
   *  to null. Synchronous on purpose: a deferred forwarder would let
   *  one frame's worth of stale range survive a file switch and let a
   *  fast Ctrl+Enter submit a comment anchored to the wrong file. */
  onChange?: (range: SelectedLineRange | null) => void;
  /** Caller-supplied extra context-menu items. Called with the current
   *  range (null when no line is selected); the returned items are
   *  appended after the built-in "Copy path" / "Copy path:N" entries.
   *  Generic so future modes (comment, bookmark, search-anchor) can
   *  contribute their own entries without `useLineSelection` learning
   *  about each one. */
  extraItems?: (range: SelectedLineRange | null) => CodeContextMenuItem[];
}

export function useLineSelection(
  path: Accessor<string>,
  options: LineSelectionOptions = {},
): LineSelection {
  const [range, setRange] = createSignal<SelectedLineRange | null>(null);

  const setAndForward = (r: SelectedLineRange | null) => {
    setRange(r);
    options.onChange?.(r);
  };

  // Seed + reseed through `setAndForward` so file-switch resets reach
  // external observers in the same frame the file changes (not deferred).
  createEffect(
    on(
      () => [path(), options.initialRange?.() ?? null] as const,
      ([, initial]) => setAndForward(initial),
    ),
  );

  return {
    range,
    handleSelect: setAndForward,
    buildItems: () => {
      const items: CodeContextMenuItem[] = [
        { label: "Copy path", textToCopy: path() },
      ];
      const r = range();
      if (r) {
        const ref = formatLineRef(path(), r.start, r.end);
        items.push({ label: `Copy ${ref}`, textToCopy: ref });
      }
      if (options.extraItems) items.push(...options.extraItems(r));
      return items;
    },
  };
}
