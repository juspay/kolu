/**
 * The active host's terminals, as the port surfaces ask about them — "which
 * terminal serves this port, and how do I get there?" and "which ports does ANY
 * terminal's subtree hold?".
 *
 * The link rule is `servingLink` (pure, beside it). What lives here is the SOURCE
 * of the candidates — every pane of every tile in the active host's store — built
 * once per owner as a memo, because both the Ports section and the printed-URL
 * card ask per row / per render.
 *
 * Panes and not tiles, because a dev server almost always runs in a split and the
 * scanner attributes the port to the split's own subtree; `servingLink` folds the
 * answer back to the tile the user can activate.
 */

import { activeArm } from "@kolu/padi-client/surface";
import { createMemo } from "solid-js";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { servingLink } from "./terminalServingPort";

export interface HostTerminals {
  /** The tile serving `port` and the way to it, or `undefined` when no KNOWN
   *  terminal subtree holds it. */
  servingFor: (port: number) => { name: string; jump: () => void } | undefined;
  /** Every port some terminal subtree holds — or `unknown` while any pane has
   *  not been scanned yet, because then "no terminal holds it" cannot be said.
   *  That sentence is what "detached" means, so it must be earned positively. */
  heldPorts: () => ReadonlySet<number> | "unknown";
}

export function useHostTerminals(): HostTerminals {
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
  const heldPorts = createMemo((): ReadonlySet<number> | "unknown" => {
    const held = new Set<number>();
    for (const c of candidates()) {
      if (c.ports.status !== "known") return "unknown";
      for (const p of c.ports.list) held.add(p.port);
    }
    return held;
  });
  return {
    servingFor: (port) =>
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
      }),
    heldPorts,
  };
}
