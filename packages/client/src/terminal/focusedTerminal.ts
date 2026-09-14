import type { TerminalId } from "kolu-common/surface";
import { match } from "ts-pattern";
import { containingTileOf, type ParentEdge } from "./terminalTree";

/** The one written focus value. `tileHint` bridges only the interval before a
 *  newly-created terminal's retained metadata arrives. */
export interface TerminalFocus {
  id: TerminalId;
  tileHint: TerminalId;
}

/** A terminal's live placement in the retained metadata collection.
 *
 *  `Live`, not `Terminal`, because `@kolu/padi-client/surface` now exports a
 *  `TerminalPlacement` too and the two answer DIFFERENT questions in the same
 *  domain — one directory over, in `useTerminalCrud.ts`, both are in scope. That
 *  one is the create-time INTENT a caller states and the wire requires: two arms,
 *  `toplevel` / `child-of`, with no way to say "I don't know". This one is the
 *  answer to a LOOKUP against retained metadata, which is why it has a third arm
 *  the intent sum must never grow — `missing`, for an id the collection has not
 *  got — and why its arms are named for what the canvas renders (`top-level` /
 *  `split`) rather than for what a caller asked for. */
export type LivePlacement =
  | { kind: "missing" }
  | { kind: "top-level" }
  | { kind: "split"; parentId: TerminalId };

/** Parent-edge adapter over a placement lookup — the walk used by
 *  `activeTileOf` so nested splits resolve to the root canvas tile. */
function parentEdgeFromPlacement(
  placementOf: (id: TerminalId) => LivePlacement,
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
  placementOf: (id: TerminalId) => LivePlacement,
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
