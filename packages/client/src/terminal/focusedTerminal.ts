import type { TerminalId } from "kolu-common/surface";
import { match } from "ts-pattern";

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

/** Fold the one focus value to its containing top-level tile. Live placement
 *  always overrides the write-time hint, so later re-parenting wins. */
export function activeTileOf(
  focus: TerminalFocus | null,
  placementOf: (id: TerminalId) => TerminalPlacement,
): TerminalId | null {
  if (focus === null) return null;
  return match(placementOf(focus.id))
    .with({ kind: "missing" }, () => focus.tileHint)
    .with({ kind: "top-level" }, () => focus.id)
    .with({ kind: "split" }, ({ parentId }) => parentId)
    .exhaustive();
}
