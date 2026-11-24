/** Draggables and droppables: an id registered with the nearest drag scope for
 *  the lifetime of the calling owner, bound to its elements through refs. */

import { Draggable, Droppable } from "@dnd-kit/dom";
import { type Accessor, createEffect, type JSX, onCleanup } from "solid-js";
import {
  type DragDropScope,
  type DragTransform,
  NO_TRANSFORM,
  useDragDropScope,
} from "./DragDropProvider";

/** The nearest scope, or a loud failure naming the caller: a draggable outside
 *  every scope is a wiring bug, never a drag that quietly does nothing. */
export function requireDragDropScope(caller: string): DragDropScope {
  const scope = useDragDropScope();
  if (!scope)
    throw new Error(`${caller}: no drag scope — wrap it in a DragDropProvider`);
  return scope;
}

export type DraggableHandle = {
  /** The dragged element: what the drag measures and the overlay is sized to. */
  ref: (el: HTMLElement) => void;
  /** The element a press starts the drag on — the dragged element itself, or
   *  a grip inside it. dnd-kit's pointer sensor binds it while it is mounted;
   *  with no handle mounted, the draggable cannot be picked up. */
  handleRef: (el: HTMLElement) => void;
  isActiveDraggable: Accessor<boolean>;
  /** The drag's offset while this one is dragged, else none. */
  transform: Accessor<DragTransform>;
};

export type DroppableHandle = {
  /** The element the droppable is measured from when a drag starts. */
  ref: (el: HTMLElement) => void;
  isActiveDroppable: Accessor<boolean>;
};

export function createDraggable(
  id: string,
  options?: {
    /** While true, a press on the handle starts nothing. */
    disabled?: Accessor<boolean>;
  },
): DraggableHandle {
  const scope = requireDragDropScope("createDraggable");
  const draggable = new Draggable({ id, register: false }, scope.manager);
  draggable.register();
  onCleanup(draggable.destroy);
  const disabled = options?.disabled;
  if (disabled)
    createEffect(() => {
      draggable.disabled = disabled();
    });
  const isActiveDraggable = () => scope.activeId() === id;
  return {
    ref: (el) => {
      draggable.element = el;
    },
    handleRef: (el) => {
      draggable.handle = el;
      onCleanup(() => {
        if (draggable.handle === el) draggable.handle = undefined;
      });
    },
    isActiveDraggable,
    transform: () => (isActiveDraggable() ? scope.transform() : NO_TRANSFORM),
  };
}

export function createDroppable(id: string): DroppableHandle {
  const scope = requireDragDropScope("createDroppable");
  const droppable = new Droppable(
    { id, register: false, collisionDetector: scope.collisionDetector },
    scope.manager,
  );
  droppable.register();
  onCleanup(droppable.destroy);
  return {
    ref: (el) => {
      scope.droppableElements.set(droppable, el);
    },
    isActiveDroppable: () => scope.overId() === id,
  };
}

/** A drag offset as a `style` object — empty when there is no offset, so an
 *  element at rest carries no `transform` at all. */
export function transformStyle(transform: DragTransform): JSX.CSSProperties {
  return transform.x === 0 && transform.y === 0
    ? {}
    : { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` };
}
