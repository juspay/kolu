/** Tile-placement classification — the pure decision the canvas's default-
 *  placement effect makes for each tile on a `tileIds` change: keep its
 *  resolved layout, assign a fresh default, or DEFER because we can't yet tell
 *  a genuinely-new tile from a returning one whose saved layout is still in
 *  flight.
 *
 *  Extracted from `TerminalCanvas`'s effect so the switch-back split-loss rule
 *  is unit-testable without rendering the canvas. The load-bearing case is
 *  `defer`: on a host switch the tile list (`terminalListSub`) re-keys to the
 *  new host FASTER than its per-terminal `canvasLayout` metadata re-arrives, so
 *  a returning tile briefly has NO resolved layout AND NO metadata record. The
 *  old effect treated any no-layout tile as new and stamped a default layout —
 *  which `onLayoutChange` PERSISTS, clobbering the saved split arrangement (the
 *  first-visit path dodged it because the initial snapshot carried the layout).
 *  Deferring until the record arrives lets a returning tile resolve its saved
 *  layout (no clobber) while a genuinely-new tile — whose record HAS arrived and
 *  simply carries no `canvasLayout` — still default-places at once. */

import type { TileId } from "../tile/tileContent";
import type { TileLayout } from "./TileLayout";

export type TilePlacement =
  /** A resolved layout exists (pending override or saved metadata) — keep it. */
  | { id: TileId; kind: "existing"; layout: TileLayout }
  /** No layout, but the metadata record HAS arrived → genuinely new; assign a
   *  default and persist it. */
  | { id: TileId; kind: "new" }
  /** No layout AND no metadata record yet → indistinguishable from a returning
   *  tile whose saved layout is still in flight; wait, don't clobber. */
  | { id: TileId; kind: "defer" };

/** Classify each tile for placement. `layoutOf` is the effective layout (pending
 *  ⊕ saved); `hasMetadataRecord` is whether the tile's server metadata RECORD has
 *  arrived on the client yet (`store.getMetadata(id) !== undefined`) — the signal
 *  that separates "new tile, no saved layout" from "returning tile, layout still
 *  loading". */
export function planTilePlacements(
  ids: readonly TileId[],
  layoutOf: (id: TileId) => TileLayout | undefined,
  hasMetadataRecord: (id: TileId) => boolean,
): TilePlacement[] {
  return ids.map((id) => {
    const existing = layoutOf(id);
    if (existing) return { id, kind: "existing", layout: existing };
    if (!hasMetadataRecord(id)) return { id, kind: "defer" };
    return { id, kind: "new" };
  });
}
