/** Sortables: items of one ordered list that are dragged onto each other.
 *
 *  A sortable is a draggable and a droppable under one id. While one is dragged
 *  over another, the list shows the order a drop would produce — the dragged
 *  item moved to the target's index — by shifting each displaced item into the
 *  slot it would take. Nothing is written until the scope's `onDragEnd`; the
 *  preview is paint only.
 *
 *  Every sortable joins the NEAREST `SortableProvider`, and only ids in that
 *  provider's list take part in its preview. */

import {
  type Accessor,
  type Component,
  createContext,
  createMemo,
  untrack,
  useContext,
} from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  type DragTransform,
  NO_TRANSFORM,
  useDragDropScope,
} from "./DragDropProvider";
import {
  createDraggable,
  createDroppable,
  type DraggableHandle,
} from "./draggable";

type SortableList = {
  ids: Accessor<readonly string[]>;
  /** The preview order: `ids` with the dragged id moved to the target's index. */
  sortedIds: Accessor<readonly string[]>;
};

const SortableContext = createContext<SortableList>();

export const SortableProvider: Component<{
  ids: readonly string[];
  children: JSX.Element;
}> = (props) => {
  const scope = useDragDropScope();
  const sortedIds = createMemo(() => {
    const ids = props.ids;
    const from = ids.indexOf(scope.activeId() ?? "");
    const to = ids.indexOf(scope.overId() ?? "");
    if (from === -1 || to === -1 || from === to) return ids;
    const next = ids.slice();
    next.splice(to, 0, ...next.splice(from, 1));
    return next;
  });
  return (
    <SortableContext value={{ ids: () => props.ids, sortedIds }}>
      {props.children}
    </SortableContext>
  );
};

export type SortableHandle = {
  /** The item's element: dragged, and measured as a drop target. */
  ref: (el: HTMLElement) => void;
  /** Where a press picks the item up — see {@link DraggableHandle.handleRef}. */
  handleRef: (el: HTMLElement) => void;
  isActiveDraggable: Accessor<boolean>;
  isActiveDroppable: Accessor<boolean>;
  /** Where the item is drawn: following the pointer while it is dragged (unless
   *  the scope draws an overlay), shifted into its preview slot otherwise. */
  transform: Accessor<DragTransform>;
};

/** `id` is an ACCESSOR, read inside this hook's own derivations (the preview
 *  slot below), so a caller hands the item's id straight through without
 *  reading it in its component body. The dnd-kit registration cannot follow
 *  it — a registered draggable keeps the id it was created with for this
 *  owner's lifetime — so the id is sampled once and every later read is
 *  checked against it: a sortable whose id changed would be registered under
 *  the old id while its preview slot followed the new one, silently. Every
 *  caller renders one sortable per keyed list item, so an instance IS its id. */
export function createSortable(id: Accessor<string>): SortableHandle {
  const scope = useDragDropScope();
  // `SortableContext` has no default: a sortable outside a list throws
  // (`ContextNotFoundError`).
  const list = useContext(SortableContext);
  const registered = untrack(id);
  const draggable = createDraggable(registered);
  const droppable = createDroppable(registered);
  /** This item's id, refused if it is no longer the one registered. */
  const itemId = (): string => {
    const now = id();
    if (now !== registered) {
      throw new Error(
        `createSortable was given a changing id (${registered} -> ${now}) — ` +
          "the dnd-kit draggable and droppable keep the id they were " +
          "registered with for this owner's lifetime, so the drag would move " +
          "one item while the preview shifted another. Render one sortable " +
          "per id, under a keyed loop.",
      );
    }
    return now;
  };
  // The offset from this item's own start rect to the rect of the slot the
  // preview order puts it in.
  const slotOffset = (): DragTransform => {
    const self = itemId();
    const slot = list.sortedIds().indexOf(self);
    const home = list.ids().indexOf(self);
    if (slot === -1 || slot === home) return NO_TRANSFORM;
    const from = scope.startRect(self);
    const to = scope.startRect(list.ids()[slot] ?? "");
    if (!from || !to) return NO_TRANSFORM;
    return { x: to.left - from.left, y: to.top - from.top };
  };
  return {
    ref: (el) => {
      draggable.ref(el);
      droppable.ref(el);
    },
    handleRef: draggable.handleRef,
    isActiveDraggable: draggable.isActiveDraggable,
    isActiveDroppable: droppable.isActiveDroppable,
    transform: () =>
      draggable.isActiveDraggable() && !scope.hasOverlay()
        ? draggable.transform()
        : slotOffset(),
  };
}
