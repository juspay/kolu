/** Persist a terminal's canvas tile position/size on the server.
 *
 *  The single RPC writer for canvas layout, kept as a LEAF (it depends only on
 *  the wire client + toast) so both the tile registry's `setLayout` seam and any
 *  terminal-side caller share one home without dragging the heavier
 *  `useTerminalCrud` graph — and its import cycle — along. Layout still lands on
 *  `TerminalMetadata.canvasLayout` (no schema change); this is just where the
 *  write itself lives. */

import type { CanvasLayout, TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { client } from "../wire";

export function persistCanvasLayout(
  id: TerminalId,
  layout: CanvasLayout,
): void {
  void client.terminal
    .setCanvasLayout({ id, layout })
    .catch((err: Error) =>
      toast.error(`Failed to save canvas layout: ${err.message}`),
    );
}
