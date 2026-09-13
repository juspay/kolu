/**
 * The active host's terminals, as the port surfaces ask about them — "which
 * terminal serves this port, and how do I get there?", "which ports does ANY
 * terminal's subtree hold?", "what does THIS tile hold and print?" and "which
 * ports did any terminal print?".
 *
 * Every walk of "every pane of every tile" the Ports section and the printed-URL
 * card need lives here, so the sets `portGroups` joins arrive from ONE source
 * over the same store rather than being re-walked at each call site.
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
import {
  foldPorts,
  knownPorts,
  type PortInfo,
  type TerminalId,
} from "kolu-common/surface";
import { createMemo } from "solid-js";
import { printedPortsOf } from "../terminal/printedPorts";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { servingLink } from "./terminalServingPort";

/** Set equality — the `equals` gate for the printed-port memos, so an unrelated
 *  terminal tick that re-derives the same set does not re-run a join. */
export const sameSet = (
  a: ReadonlySet<number>,
  b: ReadonlySet<number>,
): boolean => a.size === b.size && [...a].every((p) => b.has(p));

export interface HostTerminals {
  /** The tile serving `port` and the way to it, or `undefined` when no KNOWN
   *  terminal subtree holds it. */
  servingFor: (port: number) => { name: string; jump: () => void } | undefined;
  /** Every port some terminal subtree holds — or `unknown` while any pane has
   *  not been scanned yet, because then "no terminal holds it" cannot be said.
   *  That sentence is what "detached" means, so it must be earned positively. */
  heldPorts: () => ReadonlySet<number> | "unknown";
  /** A tile's subtree ports, folded across every pane of it. `knownPorts` is
   *  the ONE place "we never looked" reads as no ports: a pane whose first scan
   *  has not landed contributes nothing rather than asserting it serves nothing.
   *  A plain derivation — a caller that needs identity across equal recomputes
   *  wraps it in a memo with `samePortList`. */
  tilePorts: (tileId: TerminalId) => readonly PortInfo[];
  /** The ports a tile's panes printed a loopback URL for. A plain derivation —
   *  memo it with {@link sameSet} for identity. */
  printedBy: (tileId: TerminalId) => ReadonlySet<number>;
  /** The ports ANY terminal on this host printed — the story an unclaimed
   *  socket needs. */
  printedOnHost: () => ReadonlySet<number>;
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
  const printedBy = (tileId: TerminalId): ReadonlySet<number> =>
    new Set(store.getTilePaneIds(tileId).flatMap((id) => printedPortsOf(id)));
  const printedOnHost = createMemo(
    () =>
      new Set(store.terminalIds().flatMap((tileId) => [...printedBy(tileId)])),
    undefined,
    { equals: sameSet },
  );
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
    tilePorts: (tileId) =>
      foldPorts(
        store.getTilePaneIds(tileId).flatMap((id) => {
          const arm = activeArm(store.getMetadata(id));
          return arm === undefined ? [] : knownPorts(arm.ports);
        }),
      ),
    printedBy,
    printedOnHost,
  };
}
