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
