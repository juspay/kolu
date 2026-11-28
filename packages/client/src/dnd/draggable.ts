/** Draggables and droppables: an id registered with the nearest drag scope for
 *  the lifetime of the calling owner, bound to its elements through refs. */

import { Draggable, Droppable } from "@dnd-kit/dom";
import { type Accessor, createEffect, onCleanup, onSettled } from "solid-js";
import type { JSX } from "@solidjs/web";
import { nearestCenter } from "./collision";
import {
  type DragTransform,
  NO_TRANSFORM,
  useDragDropScope,
} from "./DragDropProvider";

export type DraggableHandle = {
  /** The dragged element: what the drag measures and the overlay is sized to. */
  ref: (el: HTMLElement) => void;
  /** The element a press starts the drag on — a grip inside the dragged
   *  element. The scope's pointer sensor binds the press to THAT element
   *  alone, so a draggable with no handle bound cannot be picked up. */
  handleRef: (el: HTMLElement) => void;
  /** Unbinds the handle. A caller whose grip is rendered conditionally calls
   *  this when that grip goes, so the draggable never keeps a detached node as
   *  its press target; the calling owner's disposal unbinds it too. */
  releaseHandle: () => void;
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
  // A ref callback is not a scope a cleanup may be registered in (Solid 2
  // answers `CLEANUP_IN_FORBIDDEN_SCOPE`), so the element the ref recorded is
  // held here and unbound either by this factory's own owner or by an explicit
  // `releaseHandle` from the caller that knows its grip went.
  let handleEl: HTMLElement | undefined;
  const releaseHandle = () => {
    if (handleEl === undefined) return;
    if (draggable.handle === handleEl) draggable.handle = undefined;
    handleEl = undefined;
  };
  onCleanup(releaseHandle);
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
    handleRef: (el) => {
      handleEl = el;
      draggable.handle = el;
    },
    releaseHandle,
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
