import { closestCenter, type CollisionDetector } from "@thisbeyond/solid-dnd";
import type { TerminalId } from "kolu-common/surface";
import type { ParentEdge } from "../../terminal/terminalTree";

export const ROW_DRAG_PREFIX = "row:";
export const HEADER_DROP_ID = "drop:header";

export function rowDragId(id: TerminalId): string {
  return `${ROW_DRAG_PREFIX}${id}`;
}

export function rowIdOfDragId(id: string | number): TerminalId | null {
  const s = String(id);
  return s.startsWith(ROW_DRAG_PREFIX) ? s.slice(ROW_DRAG_PREFIX.length) : null;
}

export type DockDropTarget =
  | { kind: "row"; id: TerminalId }
  | { kind: "header" };

export function dropTargetOfDroppableId(
  id: string | number,
): DockDropTarget | null {
  if (String(id) === HEADER_DROP_ID) return { kind: "header" };
  const rowId = rowIdOfDragId(id);
  return rowId === null ? null : { kind: "row", id: rowId };
}

export type DockDropContext = {
  parentEdge: ParentEdge;
  isLive: (id: TerminalId) => boolean;
};

export function reparentDropOf(
  ctx: DockDropContext,
  draggedId: TerminalId,
  target: DockDropTarget,
): { id: TerminalId; parentId: TerminalId | null } | null {
  if (target.kind === "header") {
    const parent = ctx.parentEdge(draggedId);
    if (parent === null || parent === undefined) return null;
    return { id: draggedId, parentId: null };
  }

  const targetId = target.id;
  if (targetId === draggedId) return null;
  if (!ctx.isLive(targetId)) return null;
  const targetParent = ctx.parentEdge(targetId);
  if (targetParent === undefined) return null;
  if (ctx.parentEdge(draggedId) === targetId) return null;

  const seen = new Set<TerminalId>([targetId]);
  let cur: TerminalId | null | undefined = targetParent;
  while (cur !== null && cur !== undefined) {
    if (cur === draggedId) return null;
    if (seen.has(cur)) break;
    seen.add(cur);
    cur = ctx.parentEdge(cur);
  }

  return { id: draggedId, parentId: targetId };
}

export function dropHighlightOf(
  ctx: DockDropContext,
  draggedId: TerminalId,
  target: DockDropTarget,
): "over" | "invalid" {
  return reparentDropOf(ctx, draggedId, target) === null ? "invalid" : "over";
}

export const dockCollisionDetector: CollisionDetector = (
  draggable,
  droppables,
  context,
) => {
  const isRowDrag = rowIdOfDragId(draggable.id) !== null;
  const candidates = droppables.filter(
    (droppable) =>
      (dropTargetOfDroppableId(droppable.id) !== null) === isRowDrag,
  );
  return closestCenter(draggable, candidates, context);
};
