import type { CanvasLayout } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { runAction } from "../runAction";
import { activePadiRpc } from "../wire";

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
