/** The drag half of a dock row — the sockets a row hands the shared row
 *  component, and the hover verdict painted on it.
 *
 *  DESKTOP ONLY, by construction rather than by a flag: these sockets are
 *  created against the nearest drag context, and the touch drawer renders none.
 *  Both hooks therefore THROW when they find no context — a caller that reached
 *  them from the drawer has a wiring bug, and a silent no-op would show up as
 *  "dragging does nothing on my phone" instead.
 *
 *  Two sockets, not one: the row element is BOTH the draggable (what the library
 *  measures and resolves against) and the droppable (a row is a drop target in
 *  its own right). The GESTURE, though, is not on the row — kolu passes the
 *  activators to the package as `handle`, which renders the grip that carries
 *  them and stops them at the row's own boundary (see `DockRow`). A pointerdown
 *  on the row's body therefore still reaches the branch cluster's activator,
 *  which is the #2249 behaviour this feature must not break. */

import { activeArm } from "@kolu/padi-client/surface";
import type { DockDragHandlers } from "@kolu/solid-dockrow";
import {
  createDraggable,
  createDroppable,
  useDragDropContext,
} from "@thisbeyond/solid-dnd";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import {
  type DockDropTarget,
  dropHighlightOf,
  rowDragId,
  rowIdOfDragId,
} from "./dockReparent";

/** The drag wiring ONE row takes. `handle` and `drop` are read reactively by
 *  the row (a row's grip appears only while its terminal is LIVE; its drop
 *  verdict changes as the pointer moves), so they are getters. */
export type DockRowDrag = {
  /** Registers the row ELEMENT as the draggable + droppable node. */
  ref: (el: HTMLElement) => void;
  /** The grip's listeners — absent on a row that cannot be dragged right now. */
  handle: DockDragHandlers | undefined;
  drop: "over" | "invalid" | undefined;
};

/** The terminal id of the row being dragged, or `null` when the active drag is
 *  not a row drag — a branch cluster, or nothing at all. The one reader is the
 *  repo card's header, which is a drop target for ROW drags only. */
export function useDraggedRowId(): Accessor<TerminalId | null> {
  const context = useDragDropContext();
  if (!context)
    throw new Error(
      "useDraggedRowId: no drag context — a dock drop target exists only inside the desktop dock's DragDropProvider",
    );
  const [state] = context;
  return () => rowIdOfDragId(state.active.draggableId ?? "");
}

/** The hover verdict for one drop TARGET: `undefined` unless a row drag is
 *  resting on it. ONE fold for every target a dock row can land on — the rows
 *  themselves and the repo card's header — so "would this drop be accepted" is
 *  asked once and painted identically wherever it is asked. */
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
  // The app facts the drop rules need, read live off the store: the parent edge
  // the tree walks, and the same live-arm gate the split shortcuts use.
  const drop = {
    parentEdge: store.parentEdge,
    isLive: (id: TerminalId) => activeArm(store.getMetadata(id)) !== undefined,
  };
  return createMemo(() => {
    if (!isActiveTarget()) return undefined;
    const dragged = rowIdOfDragId(state.active.draggableId ?? "");
    // A cluster drag hovering this target is not this target's business: the
    // verdict is about ROW drops.
    if (dragged === null) return undefined;
    return dropHighlightOf(drop, dragged, target);
  });
}

/** One desktop dock row's drag sockets. */
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
  // A row whose terminal is SLEEPING is neither draggable nor a drop target:
  // its grip is not rendered (so no gesture can start) and the drop rules refuse
  // it (a live row must not nest under a dormant parent that has no live pane to
  // show it in). The droppable stays registered so the refusal can be PAINTED —
  // a sleeping row under the pointer reads as "no", rather than letting the drop
  // silently resolve to some other row behind it.
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
