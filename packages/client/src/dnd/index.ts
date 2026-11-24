/** kolu's drag and drop: `@dnd-kit/dom` for sensing, collision and the drag
 *  lifecycle, bound to Solid here. kolu paints every drag itself — the binding
 *  hands out ids, element refs and reactive transforms, and never moves an
 *  element on its own.
 *
 *  - `DragDropProvider` — a drag scope (one dnd-kit manager). Scopes nest; every
 *    item joins the nearest one.
 *  - `createDraggable` / `createDroppable` — one id each, registered for the
 *    calling owner's lifetime. A draggable is picked up from its handle.
 *  - `SortableProvider` / `createSortable` — an ordered list with a live
 *    preview of the order a drop would produce.
 *  - `data-no-drag` — an attribute on a control inside a handle (a title-bar
 *    button, a link) that keeps a press on it from starting a drag.
 *  - `transformStyle` — a drag offset as a `style` object. */

export {
  DragDropProvider,
  type DragTransform,
  type DropEvent,
  NO_TRANSFORM,
} from "./DragDropProvider";
export {
  createDraggable,
  createDroppable,
  type DraggableHandle,
  type DroppableHandle,
  requireDragDropScope,
  transformStyle,
} from "./draggable";
export {
  createSortable,
  type SortableHandle,
  SortableProvider,
} from "./sortable";
