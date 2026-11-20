import type { TerminalId } from "kolu-common/surface";
import { match } from "ts-pattern";
import { containingTileOf, type ParentEdge } from "./terminalTree";

export interface TerminalFocus {
  id: TerminalId;
  tileHint: TerminalId;
}

export type LivePlacement =
  | { kind: "missing" }
  | { kind: "top-level" }
  | { kind: "split"; parentId: TerminalId };

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
