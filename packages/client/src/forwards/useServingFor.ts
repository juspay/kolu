/**
 * "Which terminal serves this port, and how do I get there?" — for the ACTIVE
 * host, as the Ports section and the printed-URL card both ask it.
 *
 * The rule is `servingLink` (pure, beside it). What lives here is the SOURCE of
 * the candidates — every pane of every tile in the active host's store — built
 * once per owner as a memo, because both callers ask per row / per render and
 * rebuilding every pane's metadata read each time is O(rows × terminals).
 *
 * Panes and not tiles, because a dev server almost always runs in a split and the
 * scanner attributes the port to the split's own subtree; `servingLink` folds the
 * answer back to the tile the user can activate.
 */

import { activeArm } from "@kolu/padi-client/surface";
import { createMemo } from "solid-js";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { servingLink } from "./terminalServingPort";

export function useServingFor(): (
  port: number,
) => { name: string; jump: () => void } | undefined {
  const store = useTerminalStore();
  const candidates = createMemo(() =>
    store.terminalIds().flatMap((tileId) =>
      store.getTilePaneIds(tileId).flatMap((paneId) => {
        const arm = activeArm(store.getMetadata(paneId));
        // `parentId` here is the CONTAINING TILE (root), not the true one-hop
        // parent — the port join returns the tile the user can activate.
        return arm === undefined
          ? []
          : [
              {
                id: paneId,
                parentId: paneId === tileId ? null : tileId,
                ports: arm.ports,
              },
            ];
      }),
    ),
  );
  return (port) =>
    servingLink({
      port,
      candidates: candidates(),
      armOf: (id) => {
        const arm = activeArm(store.getMetadata(id));
        return arm === undefined
          ? undefined
          : { git: arm.git ?? null, cwd: arm.cwd };
      },
      activate: (id) => store.activate(id),
    });
}
