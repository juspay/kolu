/** The collision rule every kolu drag scope resolves with: the droppable whose
 *  centre is nearest the centre of the dragged element AS DRAWN — the
 *  operation's shape, which `DragTracker` keeps at the source's start rect
 *  shifted by the drag. Nothing else counts: not where the pointer is, not how
 *  much the shapes overlap. dnd-kit's own `closestCenter` asks those first, so
 *  kolu states the rule itself.
 *
 *  Pure: no Solid, no DOM. */

import { CollisionPriority, CollisionType } from "@dnd-kit/abstract";
import type { CollisionDetector } from "@dnd-kit/collision";
import { Point } from "@dnd-kit/geometry";

export const nearestCenter: CollisionDetector = ({
  dragOperation,
  droppable,
}) => {
  const dragged = dragOperation.shape?.current;
  if (!dragged || !droppable.shape) return null;
  return {
    id: droppable.id,
    value: 1 / Point.distance(dragged.center, droppable.shape.center),
    type: CollisionType.Collision,
    priority: CollisionPriority.Normal,
  };
};
