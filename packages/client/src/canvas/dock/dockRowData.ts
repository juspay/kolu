/** Reactive pairing for a Dock row's stable display identity and live metadata. */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { cwdBasename } from "@kolu/terminal-vocab/terminalKey";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { annotationLine } from "../../intent/text";
import {
  pairDisplayRow,
  type TerminalDisplayInfo,
} from "../../terminal/terminalDisplay";
import { useTerminalStore } from "../../terminal/useTerminalStore";

/** Build the combined row value once per consumer, returning `null` until both
 * the display projection and metadata record are available.
 *
 * The id arrives as an ACCESSOR: every caller holds it as a prop, and a prop
 * read in a component body is an untracked read of reactive state. Reading it
 * inside the memo is the honest shape as well — a needs-you entry keeps its
 * identity while the TILE it hangs under changes (a blocked split can be
 * re-homed), so the pairing follows the id instead of snapshotting it. */
export function createDockRowData(
  id: Accessor<TerminalId>,
): () => { info: TerminalDisplayInfo; meta: TerminalMetadata } | null {
  const store = useTerminalStore();
  return createMemo(() =>
    pairDisplayRow(store.getDisplayInfo(id()), store.getMetadata(id())),
  );
}

/** The words a dock row shows as its annotation — the ONE author for a
 *  top-level row, for its splits, and for the drag ghost that carries one.
 *
 *  A TILE states its display identity (intent line 1, else the branch); a SPLIT
 *  has none of its own — `getDisplayInfo` is keyed on top-level tiles — so it
 *  states its working directory's basename. That asymmetry IS this fold, and
 *  spelling it once per consumer is how the drag ghost came to render an EMPTY
 *  label for every split (it asked for a display row a split cannot have) while
 *  the row underneath it showed words. */
export function dockRowLabel(
  meta: TerminalMetadata,
  info: TerminalDisplayInfo | undefined,
): string {
  return annotationLine(
    meta.intent,
    info === undefined ? cwdBasename(meta.cwd) : info.key.label,
  );
}
