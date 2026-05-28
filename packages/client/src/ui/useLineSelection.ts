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
import { CopyIcon, OpenIcon } from "./Icons";
import { formatLineRef, type LineRef } from "@kolu/file-line-ref";

export type LineSelection = {
  /** Current selection range — bind to Pierre's `selectedLines` prop
   *  so the visual highlight tracks the controller. */
  range: Accessor<SelectedLineRange | null>;
  /** Bind to Pierre's `onLineSelected` — the renderer fires this on every
   *  selection commit (single-line click or drag end). */
  handleSelect: (range: SelectedLineRange | null) => void;
  /** Bind to `<CodeContextMenu getItems>`. Returns "Copy path" plus, when
   *  a line is selected, "Copy <path>:<line>" with the rendered ref —
   *  and, when `options.onOpen` is provided, an "Open <path>:<line>"
   *  action entry that dispatches to the host. */
  buildItems: () => CodeContextMenuItem[];
};

export interface LineSelectionOptions {
  /** Externally-driven initial range — caller updates this when a new
   *  navigation request lands (e.g. terminal `path:line` click). The
   *  effect below pushes it into the controller's range, which means
   *  the right-click menu and the Pierre highlight stay in sync. */
  initialRange?: Accessor<SelectedLineRange | null | undefined>;
  /** Accessor — re-read at `buildItems()` time. Returning a handler
   *  adds an "Open <path>:<line>" entry to the menu while a range is
   *  selected; returning undefined omits it. Accessor (not bare
   *  callback) so a host whose prop arrives later in the lifecycle
   *  still flips the item in once it's available. The host is
   *  responsible for routing the ref through the Code-tab open
   *  dispatcher. */
  onOpen?: Accessor<((ref: LineRef) => void) | undefined>;
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
      // The menu is line-anchored: every entry refers to a specific
      // `path:line` ref, so a build without a selected range returns
      // empty. `<CodeContextMenu>`'s `open()` short-circuits on empty
      // items, which means the right-click on whitespace produces no
      // menu — the path-only menu was actionable noise (just one
      // "Copy path" item, redundant with the in-menu Copy entries
      // that ALSO copy the path bundled with the line).
      const r = range();
      if (!r) return [];
      // Snapshot `path()` once so label, copy text, and onActivate
      // capture all agree. Reading the accessor inside `onActivate`
      // would resolve at click time and could disagree with the
      // rendered label if Pierre remounts to a different file between
      // menu-open and click.
      const p = path();
      const refStr = formatLineRef(p, r.start, r.end);
      const items: CodeContextMenuItem[] = [
        { kind: "copy", label: "Copy path", icon: CopyIcon, textToCopy: p },
        {
          kind: "copy",
          label: `Copy ${refStr}`,
          icon: CopyIcon,
          textToCopy: refStr,
        },
      ];
      const onOpen = options.onOpen?.();
      if (onOpen) {
        items.push({
          kind: "action",
          label: `Open ${refStr}`,
          icon: OpenIcon,
          onActivate: () =>
            onOpen({ path: p, startLine: r.start, endLine: r.end }),
        });
      }
      return items;
    },
  };
}
