/** Draggables and droppables: an id registered with the nearest drag scope for
 *  the lifetime of the calling owner, bound to its elements through refs. */

import { Draggable, Droppable } from "@dnd-kit/dom";
import { type Accessor, createEffect, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import { refWithRelease } from "../ui/refWithRelease";
import { nearestCenter } from "./collision";
import {
  type DragTransform,
  NO_TRANSFORM,
  useDragDropScope,
} from "./DragDropProvider";

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
  const scope = useDragDropScope();
  const draggable = new Draggable({ id, register: false }, scope.manager);
  draggable.register();
  onCleanup(draggable.destroy);
  // The factory body (the owner this draggable already lives in) owns the
  // unbinding of the handle the ref recorded.
  const handleRef = refWithRelease<HTMLElement>(
    (el) => {
      draggable.handle = el;
    },
    (el) => {
      if (draggable.handle === el) draggable.handle = undefined;
    },
  );
  const disabled = options?.disabled;
  if (disabled)
    createEffect(
      () => disabled(),
      (off) => {
        draggable.disabled = off;
      },
    );
  const isActiveDraggable = () => scope.activeId() === id;
  return {
    ref: (el) => {
      draggable.element = el;
    },
    handleRef,
    isActiveDraggable,
    transform: () => (isActiveDraggable() ? scope.transform() : NO_TRANSFORM),
  };
}

export function createDroppable(id: string): DroppableHandle {
  const scope = useDragDropScope();
  const droppable = new Droppable(
    {
      id,
      register: false,
      collisionDetector: nearestCenter,
      accept: (source) => scope.accepts(String(source.id), id),
    },
    scope.manager,
  );
  droppable.register();
  onCleanup(droppable.destroy);
  // Once the first render has settled the element is in the document, so a drag
  // already under way can measure it.
  onSettled(() => {
    scope.measureArrival(droppable);
  });
  return {
    ref: (el) => {
      scope.attachDroppable(droppable, el);
    },
    isActiveDroppable: () => scope.overId() === id,
  };
}

/** A drag offset as a CSS `transform` value — empty when there is no offset,
 *  so an element at rest carries no `transform` at all. */
export function transformCss(transform: DragTransform): string {
  return transform.x === 0 && transform.y === 0
    ? ""
    : `translate3d(${transform.x}px, ${transform.y}px, 0)`;
}

/** {@link transformCss} as a `style` object, for a `style` binding. */
export function transformStyle(transform: DragTransform): JSX.CSSProperties {
  const css = transformCss(transform);
  return css === "" ? {} : { transform: css };
}
