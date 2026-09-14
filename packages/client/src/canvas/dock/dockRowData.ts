/** Reactive pairing for a Dock row's stable display identity and live metadata. */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { createMemo } from "solid-js";
import {
  pairDisplayRow,
  type TerminalDisplayInfo,
} from "../../terminal/terminalDisplay";
import { useTerminalStore } from "../../terminal/useTerminalStore";

/** Build the combined row value once per consumer, returning `null` until both
 * the display projection and metadata record are available. */
export function createDockRowData(
  id: TerminalId,
): () => { info: TerminalDisplayInfo; meta: TerminalMetadata } | null {
  const store = useTerminalStore();
  return createMemo(() =>
    pairDisplayRow(store.getDisplayInfo(id), store.getMetadata(id)),
  );
}
