/** Persist a terminal's canvas tile position/size on the server.
 *
 *  The single RPC writer for canvas layout, kept as a LEAF (it depends only on
 *  the wire client + toast) so both the tile registry's `setLayout` seam and any
 *  terminal-side caller share one home without dragging the heavier
 *  `useTerminalCrud` graph — and its import cycle — along. Layout still lands on
 *  `TerminalMetadata.canvasLayout` (no schema change); this is just where the
 *  write itself lives. */

import type { CanvasLayout } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { runAction } from "../runAction";
import { activePadiRpc } from "../wire";

/** Persist a tile's canvas geometry.
 *
 *  Runs at the seam rather than returning an `Effect`, because its caller is the
 *  canvas's SYNCHRONOUS drag/resize commit — a `void` echo of a local write that
 *  has already happened, with no continuation to compose into. */
export function persistCanvasLayout(
  id: TerminalId,
  layout: CanvasLayout,
): void {
  runAction(
    "save canvas layout",
    activePadiRpc.chrome.setCanvasLayout({ id, layout }).pipe(
      Effect.catch((err) =>
        Effect.sync(() => {
          toast.error(`Failed to save canvas layout: ${toError(err).message}`);
        }),
      ),
    ),
  );
}
