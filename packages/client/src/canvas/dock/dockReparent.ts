/** Re-home a dock row by drag — the ONE verb behind both drop targets in the
 *  desktop cards mode: dropping row A on row B makes A a split of B, dropping
 *  A on the repo card's header makes it a top-level tile again.
 *
 *  Pure: no SolidJS, no DOM. The gesture layer hands over a drag event's id and
 *  the app's two facts ({@link DockDropContext}) and gets back either the new
 *  edge or a refusal; the paint decision ({@link dropHighlightOf}) is the SAME
 *  rule read twice, so the hover affordance can never say "over" while the
 *  write quietly no-ops.
 *
 *  The row id is prefixed (`row:<terminalId>`) because the sortables in the
 *  same DragDropProvider key branch clusters by LABEL — a raw terminal id in
 *  that space could collide with a cluster label, and one collision is enough
 *  to turn a row drag into a cluster reorder. */

import { closestCenter, type CollisionDetector } from "@thisbeyond/solid-dnd";
import type { TerminalId } from "kolu-common/surface";
import type { ParentEdge } from "../../terminal/terminalTree";

export const ROW_DRAG_PREFIX = "row:";
/** The repo card header's droppable id. Prefixed like a row id, and for the
 *  same reason: this id lives in ONE string space with the branch-cluster
 *  sortables (keyed by branch LABEL) and the section sortables (keyed by repo
 *  NAME), so a bare `"header"` would collide with a branch or directory of that
 *  name — the library keys droppables by id, so one would silently replace the
 *  other. A colon cannot appear in a git ref, which is what makes the prefix a
 *  narrowing rather than a shorter odds. */
export const HEADER_DROP_ID = "drop:header";

/** The draggable/droppable id of a dock row — ONE id for both, so the drop
 *  verb receives the dragged row's identity in the shape it already holds. */
export function rowDragId(id: TerminalId): string {
  return `${ROW_DRAG_PREFIX}${id}`;
}

/** {@link rowDragId}'s inverse for a drag event's id — `null` when the id names
 *  nothing in the row space (a branch cluster, the header, …). */
export function rowIdOfDragId(id: string | number): TerminalId | null {
  const s = String(id);
  return s.startsWith(ROW_DRAG_PREFIX) ? s.slice(ROW_DRAG_PREFIX.length) : null;
}

export type DockDropTarget =
  | { kind: "row"; id: TerminalId }
  | { kind: "header" };

/** The two app facts the validity rules need. `isLive` is the same live-arm
 *  gate the split shortcuts use (`activeArm`): a sleeping terminal may not be a
 *  drop TARGET, because nesting a live row under a dormant parent would give it
 *  a panel with no live pane behind it. */
export type DockDropContext = {
  parentEdge: ParentEdge;
  isLive: (id: TerminalId) => boolean;
};

/** THE drop verb: what a dropped row becomes, or `null` when the drop is
 *  refused. Refused: the row itself, any of the row's own descendants, the
 *  row's CURRENT parent (no-op), a target that is not live, a target absent
 *  from the census, and the header when the row is already top-level. */
export function reparentDropOf(
  ctx: DockDropContext,
  draggedId: TerminalId,
  target: DockDropTarget,
): { id: TerminalId; parentId: TerminalId | null } | null {
  if (target.kind === "header") {
    const parent = ctx.parentEdge(draggedId);
    // `null` is a live top-level row (already home — a no-op); `undefined` is a
    // row the census never saw, which has nothing to re-home.
    if (parent === null || parent === undefined) return null;
    return { id: draggedId, parentId: null };
  }

  const targetId = target.id;
  if (targetId === draggedId) return null;
  if (!ctx.isLive(targetId)) return null;
  const targetParent = ctx.parentEdge(targetId);
  if (targetParent === undefined) return null;
  if (ctx.parentEdge(draggedId) === targetId) return null;

  // Descendant check: walk up from the target. `seen` mirrors
  // `rootAncestorOf`'s discipline — a cycle or a dangling edge ends the walk
  // instead of spinning, and merely means "nowhere above this is the dragged
  // row", i.e. the drop stands.
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

/** The same rules as a PAINT decision for the hover affordance. */
export function dropHighlightOf(
  ctx: DockDropContext,
  draggedId: TerminalId,
  target: DockDropTarget,
): "over" | "invalid" {
  return reparentDropOf(ctx, draggedId, target) === null ? "invalid" : "over";
}

/** Partition the droppables by which id space the ACTIVE drag lives in, then
 *  let `closestCenter` pick within the half that can actually answer: a row
 *  drag resolves against rows + the header, a cluster drag against everything
 *  else. Without the split a cluster sitting nearest the pointer would win a
 *  row drop (silently turning it into a cluster reorder), and a row would win a
 *  cluster drag (resolving `reorderClusters` to a no-op). */
export const dockCollisionDetector: CollisionDetector = (
  draggable,
  droppables,
  context,
) => {
  const isRowDrag = rowIdOfDragId(draggable.id) !== null;
  const candidates = droppables.filter((droppable) => {
    const inRowSpace =
      rowIdOfDragId(droppable.id) !== null || droppable.id === HEADER_DROP_ID;
    return inRowSpace === isRowDrag;
  });
  return closestCenter(draggable, candidates, context);
};
