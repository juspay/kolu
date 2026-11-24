/** kolu's drag and drop: `@dnd-kit/dom` for sensing, collision and the drag
 *  lifecycle, bound to Solid here. kolu paints every drag itself — the binding
 *  hands out ids, refs, handler dicts and reactive transforms, and never moves
 *  an element on its own.
 *
 *  - `DragDropProvider` — a drag scope (one dnd-kit manager). Scopes nest; every
 *    item joins the nearest one.
 *  - `createDraggable` / `createDroppable` — one id each, registered for the
 *    calling owner's lifetime.
 *  - `SortableProvider` / `createSortable` — an ordered list with a live
 *    preview of the order a drop would produce.
 *  - `transformStyle` — a drag offset as a `style` object. */

export {
  type DragDropScope,
  DragDropProvider,
  type DragTransform,
  type DropEvent,
  NO_TRANSFORM,
  useDragDropScope,
} from "./DragDropProvider";
export {
  createDraggable,
  createDroppable,
  type DragActivators,
  type DraggableHandle,
  type DroppableHandle,
  transformStyle,
} from "./draggable";
export {
  createSortable,
  type SortableHandle,
  SortableProvider,
} from "./sortable";
