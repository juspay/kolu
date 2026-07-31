import type { TerminalId } from "kolu-common/surface";
import { match } from "ts-pattern";
import { containingTileOf, type ParentEdge } from "./terminalTree";

/** The one written focus value. `tileHint` bridges only the interval before a
 *  newly-created terminal's retained metadata arrives. */
export interface TerminalFocus {
  id: TerminalId;
  tileHint: TerminalId;
}

/** A terminal's live placement in the retained metadata collection. */
export type TerminalPlacement =
  | { kind: "missing" }
  | { kind: "top-level" }
  | { kind: "split"; parentId: TerminalId };

/** Parent-edge adapter over a placement lookup — the walk used by
 *  `activeTileOf` so nested splits resolve to the root canvas tile. */
function parentEdgeFromPlacement(
  placementOf: (id: TerminalId) => TerminalPlacement,
): ParentEdge {
  return (id) => {
    const p = placementOf(id);
    if (p.kind === "missing") return undefined;
    if (p.kind === "top-level") return null;
    return p.parentId;
  };
}

/** Fold the one focus value to its containing top-level tile. Live placement
 *  always overrides the write-time hint, so later re-parenting wins. Under a
 *  nested chain (R ← M ← G) with focus on G this returns R — not M — so
 *  activeId / MRU / setActive never key chrome on a middle split. */
export function activeTileOf(
  focus: TerminalFocus | null,
  placementOf: (id: TerminalId) => TerminalPlacement,
): TerminalId | null {
  if (focus === null) return null;
  return match(placementOf(focus.id))
    .with({ kind: "missing" }, () => focus.tileHint)
    .with({ kind: "top-level" }, () => focus.id)
    .with({ kind: "split" }, () =>
      containingTileOf(focus.id, parentEdgeFromPlacement(placementOf)),
    )
    .exhaustive();
}
