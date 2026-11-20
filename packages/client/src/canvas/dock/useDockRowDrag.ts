import { activeArm } from "@kolu/padi-client/surface";
import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { DockDragHandlers } from "@kolu/solid-dockrow";
import {
  createDraggable,
  createDroppable,
  useDragDropContext,
} from "@thisbeyond/solid-dnd";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import type { ParentEdge } from "../../terminal/terminalTree";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import {
  type DockDropContext,
  type DockDropTarget,
  dropHighlightOf,
  rowDragId,
  rowIdOfDragId,
} from "./dockReparent";

export type DockRowDrag = {
  /** Registers the row ELEMENT as the draggable + droppable node. */
  ref: (el: HTMLElement) => void;
  /** The grip's listeners — absent on a row that cannot be dragged right now. */
  handle: DockDragHandlers | undefined;
  drop: "over" | "invalid" | undefined;
};

export function useDraggedRowId(): Accessor<TerminalId | null> {
  const context = useDragDropContext();
  if (!context)
    throw new Error(
      "useDraggedRowId: no drag context — a dock drop target exists only inside the desktop dock's DragDropProvider",
    );
  const [state] = context;
  return () => rowIdOfDragId(state.active.draggableId ?? "");
}

export function dockDropContext(store: {
  parentEdge: ParentEdge;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
}): DockDropContext {
  return {
    parentEdge: store.parentEdge,
    isLive: (id: TerminalId) => activeArm(store.getMetadata(id)) !== undefined,
  };
}

export function useDockDropVerdict(
  target: DockDropTarget,
  isActiveTarget: Accessor<boolean>,
): Accessor<"over" | "invalid" | undefined> {
  const context = useDragDropContext();
  if (!context)
    throw new Error(
      "useDockDropVerdict: no drag context — a dock drop target exists only inside the desktop dock's DragDropProvider",
    );
  const [state] = context;
  const store = useTerminalStore();
  const drop = dockDropContext(store);
  return createMemo(() => {
    if (!isActiveTarget()) return undefined;
    const dragged = rowIdOfDragId(state.active.draggableId ?? "");
    if (dragged === null) return undefined;
    return dropHighlightOf(drop, dragged, target);
  });
}

export function useDockRowDrag(id: TerminalId): DockRowDrag {
  const context = useDragDropContext();
  if (!context)
    throw new Error(
      "useDockRowDrag: no drag context — dock rows are draggable in the desktop dock only",
    );
  const store = useTerminalStore();
  const draggable = createDraggable(rowDragId(id));
  const droppable = createDroppable(rowDragId(id));
  const drop = useDockDropVerdict(
    { kind: "row", id },
    () => droppable.isActiveDroppable,
  );
  const live = () => activeArm(store.getMetadata(id)) !== undefined;
  return {
    ref: (el) => {
      draggable.ref(el);
      droppable.ref(el);
    },
    get handle() {
      return live() ? draggable.dragActivators : undefined;
    },
    get drop() {
      return drop();
    },
  };
}
