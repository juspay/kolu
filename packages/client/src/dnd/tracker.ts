/** The plugin that gives a kolu drag its geometry and reports the drag to Solid.
 *
 *  dnd-kit's own `Feedback` plugin MOVES the dragged element (into the top
 *  layer, behind a placeholder) and measures droppables live. kolu paints its
 *  drags itself — a canvas tile composes the drag into its pan/zoom transform, a
 *  sortable shows a preview order — so this plugin does the measuring instead:
 *
 *  - When a drag starts, before anything has moved, it measures the source and
 *    every droppable ONCE. Droppables resolve against those rects for the whole
 *    drag, so a sortable's preview offsets (and a dragged item that follows the
 *    pointer) never move a target out from under the collision.
 *  - As the pointer moves, the operation's shape is the source's start rect
 *    shifted by the drag transform: where the dragged element is drawn.
 *
 *  It reports to the scope through plain callbacks; it owns no Solid state. */

import { Plugin, type UniqueIdentifier } from "@dnd-kit/abstract";
import type { DragDropManager, Droppable } from "@dnd-kit/dom";
import { type Coordinates, Rectangle } from "@dnd-kit/geometry";

export type DragTrackerOptions = {
  /** The element a droppable is measured from. Droppables are registered with
   *  dnd-kit WITHOUT an element, so dnd-kit never measures them live. */
  elementOf: (droppable: Droppable) => Element | undefined;
  /** A drag began: the source's rect and every droppable's, by id. */
  onStart: (
    source: Rectangle,
    droppables: ReadonlyMap<UniqueIdentifier, Rectangle>,
  ) => void;
  /** The pointer moved: the drag's offset from where it started. */
  onMove: (transform: Coordinates) => void;
  /** Which draggable is being dragged and which droppable it is over — both
   *  `null` once the operation is over. */
  onIds: (
    sourceId: UniqueIdentifier | null,
    targetId: UniqueIdentifier | null,
  ) => void;
};

export class DragTracker extends Plugin<DragDropManager, DragTrackerOptions> {
  constructor(manager: DragDropManager, options?: DragTrackerOptions) {
    super(manager, options);
    if (!options)
      throw new Error(
        "DragTracker: configure it with DragTracker.configure(options)",
      );
    const { elementOf, onStart, onMove, onIds } = options;
    let source: Rectangle | undefined;

    const stopMeasuring = manager.monitor.addEventListener(
      "beforedragstart",
      ({ operation }) => {
        const element = operation.source?.element;
        if (!element)
          throw new Error(
            `DragTracker: draggable ${String(operation.source?.id)} has no element`,
          );
        source = Rectangle.from(element.getBoundingClientRect());
        const droppables = new Map<UniqueIdentifier, Rectangle>();
        for (const droppable of manager.registry.droppables) {
          const at = elementOf(droppable);
          if (!at) continue;
          const rect = Rectangle.from(at.getBoundingClientRect());
          droppable.shape = rect;
          droppables.set(droppable.id, rect);
        }
        onStart(source, droppables);
      },
    );

    this.registerEffect(() => {
      const operation = manager.dragOperation;
      if (!operation.status.initialized || source === undefined) return;
      const transform = operation.transform;
      operation.shape = source.translate(transform.x, transform.y);
      onMove(transform);
    });

    this.registerEffect(() => {
      const operation = manager.dragOperation;
      if (operation.status.idle) {
        source = undefined;
        onIds(null, null);
        return;
      }
      onIds(operation.sourceIdentifier, operation.targetIdentifier);
    });

    const destroy = this.destroy.bind(this);
    this.destroy = () => {
      stopMeasuring();
      destroy();
    };
  }
}
