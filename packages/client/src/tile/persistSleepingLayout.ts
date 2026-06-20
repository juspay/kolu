/** Persist a sleeping tile's canvas position/size on the server.
 *
 *  The sleeping-tile twin of `persistCanvasLayout`, kept as a LEAF (it depends
 *  only on the wire client + toast) so the tile registry's `setLayout` seam can
 *  dispatch a sleeping tile's layout write without dragging the heavier sleep/
 *  wake orchestration graph — and its import cycle — along. The layout lands on
 *  the sleeping record's top terminal (server `terminal.setSleepingLayout`), so
 *  it round-trips to disk and survives reload + restart like a live tile's. */

import type { CanvasLayout } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { client } from "../wire";
import type { TileId } from "./tileContent";

export function persistSleepingLayout(id: TileId, layout: CanvasLayout): void {
  void client.terminal
    .setSleepingLayout({ id, layout })
    .catch((err: Error) =>
      toast.error(`Failed to move sleeping tile: ${err.message}`),
    );
}
