/** Bridge between a path-less `SelectedLineRange` accessor (the shape kolu's
 *  `useLineSelection` controller exposes — line refs are scoped per file by
 *  remount, not by id) and Pierre's item-scoped `CodeViewLineSelection`
 *  (`{ id, range }`).
 *
 *  Callers wire the result accessor straight into `<CodeView selectedLines>`,
 *  and translate the `onSelectedLinesChange` payload back by reading
 *  `selection.range`. Centralises the wrap/unwrap pair so a future shape
 *  change to either side moves one file. */

import type { CodeViewLineSelection, SelectedLineRange } from "@pierre/diffs";
import { type Accessor, createMemo } from "solid-js";

export const useCodeViewSelection = (
  id: Accessor<string>,
  range: Accessor<SelectedLineRange | null>,
): Accessor<CodeViewLineSelection | null> =>
  createMemo(() => {
    const r = range();
    return r ? { id: id(), range: r } : null;
  });
