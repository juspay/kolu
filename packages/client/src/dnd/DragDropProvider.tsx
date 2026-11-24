/** A drag scope: one dnd-kit `DragDropManager`, its pointer sensor and
 *  plugins, and the Solid state its draggables, droppables and sortables read.
 *
 *  Scopes NEST, and every draggable or droppable joins the NEAREST one. That is
 *  how kolu isolates its drags: the canvas, the host strip, the dock's list of
 *  repo cards and each repo card's clusters are separate scopes, so a drag in
 *  one can never resolve against a target in another. */

import { closestCenter, type CollisionDetector } from "@dnd-kit/collision";
import {
  DragDropManager,
  type Droppable,
  PointerActivationConstraints,
  PointerSensor,
  PreventSelection,
} from "@dnd-kit/dom";
import type { Rectangle } from "@dnd-kit/geometry";
import {
  type Accessor,
  type Component,
  createContext,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  useContext,
} from "solid-js";
import { Portal } from "solid-js/web";
import { ReleasePoint } from "./releasePoint";
import { DragTracker, type DragTrackerOptions } from "./tracker";

/** The attribute a control inside a drag handle carries — a title-bar button,
 *  a link — so that a press on it stays the control's and starts no drag. */
const NO_DRAG = "data-no-drag";

/** Every scope's pointer sensor: dnd-kit's own, bound to each draggable's
 *  handle. */
const POINTER = PointerSensor.configure({
  // The pointer must travel more than 10px; a press that never moves stays a
  // click. A fresh constraint per press: a constraint holds the press's state.
  activationConstraints: () => [
    new PointerActivationConstraints.Distance({ value: 10 }),
  ],
  // Only the handle picks a draggable up — never the dragged element by
  // default, so a row whose grip is not mounted cannot be lifted by its body.
  activatorElements: (source) => [source.handle],
  preventActivation: (event, source) => {
    const { target } = event;
    if (!(target instanceof Element)) return false;
    const control = target.closest(`[${NO_DRAG}]`);
    return control !== null && source.handle?.contains(control) === true;
  },
});

export type DragTransform = { readonly x: number; readonly y: number };

export const NO_TRANSFORM: DragTransform = Object.freeze({ x: 0, y: 0 });

/** A finished drag: what was dragged, what it was released over (if anything),
 *  and how far it travelled. A cancelled drag (Escape) reports nothing. */
export type DropEvent = {
  sourceId: string;
  targetId: string | null;
  transform: DragTransform;
};

export type DragDropScope = {
  readonly manager: DragDropManager;
  /** Every droppable in this scope resolves through this. */
  readonly collisionDetector: CollisionDetector;
  /** The element each droppable is measured from when a drag starts. */
  readonly droppableElements: WeakMap<Droppable, Element>;
  /** The id being dragged, or `null`. */
  readonly activeId: Accessor<string | null>;
  /** The droppable the drag is over, or `null`. */
  readonly overId: Accessor<string | null>;
  /** The drag's offset from where it started. */
  readonly transform: Accessor<DragTransform>;
  /** A droppable's rect, measured when the current drag started. */
  readonly startRect: (id: string) => Rectangle | undefined;
  /** Whether this scope draws a ghost for the drag (see `overlay`). */
  readonly hasOverlay: Accessor<boolean>;
};

const DragDropContext = createContext<DragDropScope>();

/** The nearest drag scope, or `undefined` outside every scope. */
export function useDragDropScope(): DragDropScope | undefined {
  return useContext(DragDropContext);
}

export const DragDropProvider: Component<{
  /** How a droppable answers a drag. dnd-kit's `closestCenter` by default. */
  collisionDetector?: CollisionDetector;
  onDragEnd: (event: DropEvent) => void;
  /** A ghost that rides under the pointer for the whole drag, portalled to
   *  `document.body`: sized to at least the dragged element, centred on where
   *  that element is drawn. While a scope has one, a dragged SORTABLE stays in
   *  its preview slot instead of following the pointer. */
  overlay?: { class?: string; render: (activeId: string) => JSX.Element };
  children: JSX.Element;
}> = (props) => {
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [overId, setOverId] = createSignal<string | null>(null);
  const [transform, setTransform] = createSignal<DragTransform>(NO_TRANSFORM);
  const [sourceRect, setSourceRect] = createSignal<Rectangle>();
  const [startRects, setStartRects] = createSignal<
    ReadonlyMap<string, Rectangle>
  >(new Map());
  const droppableElements = new WeakMap<Droppable, Element>();

  const tracking: DragTrackerOptions = {
    elementOf: (droppable) => droppableElements.get(droppable),
    onStart: (source, droppables) => {
      setSourceRect(source);
      setStartRects(
        new Map([...droppables].map(([id, rect]) => [String(id), rect])),
      );
    },
    onMove: (offset) => setTransform({ x: offset.x, y: offset.y }),
    onIds: (sourceId, targetId) => {
      setActiveId(sourceId === null ? null : String(sourceId));
      setOverId(targetId === null ? null : String(targetId));
      if (sourceId === null) {
        setTransform(NO_TRANSFORM);
        setSourceRect(undefined);
        setStartRects(new Map());
      }
    },
  };
  const manager = new DragDropManager({
    plugins: [PreventSelection, DragTracker.configure(tracking), ReleasePoint],
    sensors: [POINTER],
    modifiers: [],
  });
  const stopDrop = manager.monitor.addEventListener(
    "dragend",
    ({ operation, canceled }) => {
      if (canceled || !operation.source) return;
      props.onDragEnd({
        sourceId: String(operation.source.id),
        targetId: operation.target ? String(operation.target.id) : null,
        transform: operation.transform,
      });
    },
  );
  onCleanup(() => {
    stopDrop();
    manager.destroy();
  });

  const scope: DragDropScope = {
    manager,
    collisionDetector: (input) =>
      (props.collisionDetector ?? closestCenter)(input),
    droppableElements,
    activeId,
    overId,
    transform,
    startRect: (id) => startRects().get(id),
    hasOverlay: () => props.overlay !== undefined,
  };

  return (
    <DragDropContext.Provider value={scope}>
      {props.children}
      <Show when={props.overlay}>
        {(overlay) => (
          <Portal mount={document.body}>
            <Show when={activeId()}>
              {(id) => (
                <div
                  class={overlay().class}
                  style={overlayStyle(sourceRect(), transform())}
                >
                  {overlay().render(id())}
                </div>
              )}
            </Show>
          </Portal>
        )}
      </Show>
    </DragDropContext.Provider>
  );
};

/** At least the dragged element's size, centred on where it is drawn: its
 *  start rect's centre, shifted by the drag. */
function overlayStyle(
  rect: Rectangle | undefined,
  transform: DragTransform,
): JSX.CSSProperties {
  if (!rect) return {};
  return {
    position: "fixed",
    left: `${rect.left + rect.width / 2}px`,
    top: `${rect.top + rect.height / 2}px`,
    "min-width": `${rect.width}px`,
    "min-height": `${rect.height}px`,
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0) translate(-50%, -50%)`,
    transition: "transform 0s",
  };
}
