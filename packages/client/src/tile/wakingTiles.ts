/** Tiles whose sleeping record is mid-wake — held in a tiny shared signal so the
 *  dormant tile vanishes the INSTANT Wake is clicked, before the server drops
 *  its record.
 *
 *  Why a standalone LEAF and not a field on the sleep/wake orchestration: wake
 *  re-mints fresh terminal ids when it respawns the tree, so for a beat the new
 *  live tile and the still-present sleeping record (keyed by the old id) coexist
 *  and would overlap on the canvas. The registry suppresses the stale sleeping
 *  tile by reading this set — but the registry must NOT import the crud-bearing
 *  orchestration (that would re-close the `useTileStore → useTerminalCrud → … →
 *  useTileStore` cycle Phase 1 broke). So the marker lives here, a leaf both the
 *  registry (reader) and the orchestration (writer) can depend on. */

import { createSignal } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import type { TileId } from "./tileContent";

export const useWakingTiles = createSharedRoot(() => {
  const [waking, setWaking] = createSignal<ReadonlySet<TileId>>(new Set());
  return {
    /** Tile ids currently being woken — read by the registry to hide them. */
    waking,
    mark: (id: TileId): void => {
      setWaking((prev) => new Set(prev).add(id));
    },
    unmark: (id: TileId): void => {
      setWaking((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
  };
});
