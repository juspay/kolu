/** The one pointer sensor every kolu drag scope runs: dnd-kit's own
 *  `PointerSensor`, started from a draggable's `onPointerDown` HANDLER rather
 *  than from a listener the sensor binds to the element itself.
 *
 *  Why a handler: Solid delegates `onPointerDown` to the document, so a native
 *  listener on a drag handle would fire BEFORE a descendant's delegated
 *  `stopPropagation()` — and kolu leans on that stop. A tile's title-bar buttons
 *  stop their pointerdown so pressing one never lifts the tile; a dock row's
 *  grip stops its pointerdown so grabbing it never lifts the whole branch
 *  cluster. Started from a delegated handler, the sensor sees exactly the
 *  pointerdowns the old handler dictionaries saw, in the same order.
 *
 *  Activation is the same everywhere: the pointer must travel more than 10px.
 *  A press that never moves stays a click. Nothing is "interactive" enough to
 *  refuse a drag on its own — a descendant that must not start one stops the
 *  event, as above. */

import {
  type Draggable,
  type DragDropManager,
  PointerActivationConstraints,
  PointerSensor,
  type PointerSensorOptions,
} from "@dnd-kit/dom";

const ACTIVATION: PointerSensorOptions = {
  // A fresh constraint per press: a constraint holds the press's own state.
  activationConstraints: () => [
    new PointerActivationConstraints.Distance({ value: 10 }),
  ],
  preventActivation: () => false,
};

export class DelegatedPointerSensor extends PointerSensor {
  constructor(manager: DragDropManager) {
    super(manager, ACTIVATION);
  }

  /** dnd-kit asks every sensor to bind itself to each registered draggable.
   *  This one binds nothing: {@link start} is called from the draggable's own
   *  handler. */
  override bind(): () => void {
    return () => {};
  }

  /** Begin a press on `source` — the body of a draggable's `onPointerDown`.
   *
   *  dnd-kit applies pointer moves once per animation frame, so the last move
   *  before a release can still be pending when the release ends the drag. The
   *  release is therefore applied as a final move first (a capture listener
   *  added before the sensor's own), and the drop resolves against where the
   *  pointer was let go. */
  start(event: PointerEvent, source: Draggable): void {
    const { dragOperation } = this.manager;
    const done = new AbortController();
    const forThisPointer =
      (listener: (e: PointerEvent) => void) => (e: PointerEvent) => {
        if (e.pointerId === event.pointerId) listener(e);
      };
    document.addEventListener(
      "pointerup",
      forThisPointer((up) => {
        done.abort();
        if (dragOperation.status.dragging)
          dragOperation.position.current = { x: up.clientX, y: up.clientY };
      }),
      { capture: true, signal: done.signal },
    );
    document.addEventListener(
      "pointercancel",
      forThisPointer(() => done.abort()),
      { capture: true, signal: done.signal },
    );
    this.handlePointerDown(event, source, this.options);
  }
}
