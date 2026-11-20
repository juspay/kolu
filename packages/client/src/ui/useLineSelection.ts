/** Shared line-selection + line-ref-menu wiring for Pierre's file and diff
 *  viewers: wire `handleSelect` into Pierre's `onLineSelected` and
 *  `buildItems` into `<CodeContextMenu getItems>`. */

import type { SelectedLineRange } from "@pierre/diffs";
import { type Accessor, createEffect, createSignal, on } from "solid-js";
import type { CodeContextMenuItem } from "./CodeContextMenu";
import { CopyIcon, OpenIcon } from "./Icons";
import { formatLineRef, type LineRef } from "./lineRef";

export type LineSelection = {
  /** The file the selection and the menu anchor to — the view's own path
   *  until `handleSelect` names another one. */
  path: Accessor<string>;
  /** Current selection range — bind to Pierre's `selectedLines`. */
  range: Accessor<SelectedLineRange | null>;
  /** Bind to Pierre's `onLineSelected`. `path` names the file the range is in
   *  when the view shows more than one. */
  handleSelect: (range: SelectedLineRange | null, path?: string) => void;
  /** Bind to `<CodeContextMenu getItems>`. */
  buildItems: () => CodeContextMenuItem[];
};

export interface LineSelectionOptions {
  /** Externally-driven initial range, pushed into the controller's range. */
  initialRange?: Accessor<SelectedLineRange | null | undefined>;
  /** Accessor re-read at `buildItems()` time: returning a handler adds an
   *  "Open <path>:<line>" entry while a range is selected. */
  onOpen?: Accessor<((ref: LineRef) => void) | undefined>;
}

export function useLineSelection(
  scope: Accessor<string>,
  options: LineSelectionOptions = {},
): LineSelection {
  const [range, setRange] = createSignal<SelectedLineRange | null>(
    options.initialRange?.() ?? null,
  );
  const [anchor, setAnchor] = createSignal<string | null>(null);
  const path = () => anchor() ?? scope();

  createEffect(
    on(
      () => [scope(), options.initialRange?.() ?? null] as const,
      ([, initial]) => {
        setAnchor(null);
        setRange(initial);
      },
      { defer: true },
    ),
  );

  return {
    path,
    range,
    handleSelect: (r, p) => {
      setAnchor(p ?? null);
      setRange(r);
    },
    buildItems: () => {
      const r = range();
      if (!r) return [];
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
