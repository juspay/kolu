/** Minimal pointer-based drag primitive — replacement for
 *  `@thisbeyond/solid-dnd`'s `createDraggable` + `DragDropProvider`.
 *
 *  Motivation: bypassing `createDraggable` in a heap-snapshot bisect dropped
 *  `system/Context` growth per 30 canvas/focus toggles out of the top-25
 *  classes entirely (Context Δ ~2,308 → effectively <300). solid-dnd
 *  routes drag events through a `DragDropContext` and registers the
 *  draggable in a reactive store on the provider; each mount/dispose
 *  cycle retained closures past the owner's cleanup.
 *
 *  Shape-compatible with the call-sites we had: returns
 *  `{ dragActivators, transform }` so a consumer spreads the activators
 *  on its drag handle and reads `transform.x/y` during a drag. `onMove`
 *  and `onEnd` deliver the screen-space delta from pointer-down; the
 *  caller normalizes by zoom etc. We don't emit `onStart` yet (no
 *  consumer needs it). */

import { createSignal, onCleanup } from "solid-js";

export interface DragDelta {
  x: number;
  y: number;
}

export interface DragOptions {
  /** Fires on every pointermove while a drag is in flight. */
  onMove?: (delta: DragDelta) => void;
  /** Fires once on pointerup/cancel. The final delta is passed so callers
   *  can commit even when a run of pointermove events has been coalesced. */
  onEnd?: (delta: DragDelta) => void;
}

export function createDrag(opts: DragOptions = {}) {
  const [transform, setTransform] = createSignal<DragDelta>({ x: 0, y: 0 });
  let abort: AbortController | null = null;

  // Covers unmount mid-drag — without this the window listeners outlive
  // the component and any pointermove after dispose would call into a
  // nulled-out handler.
  onCleanup(() => abort?.abort());

  function onPointerDown(e: Event) {
    const pe = e as PointerEvent;
    if (pe.button !== 0) return;
    // Don't preventDefault here — we still want the click/focus event
    // bubbled from the handle for selection semantics.
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    const { signal } = controller;
    const startX = pe.clientX;
    const startY = pe.clientY;

    const move = (ev: Event) => {
      const pv = ev as PointerEvent;
      const d = { x: pv.clientX - startX, y: pv.clientY - startY };
      setTransform(d);
      opts.onMove?.(d);
    };
    const end = (ev: Event) => {
      const pv = ev as PointerEvent;
      const d = { x: pv.clientX - startX, y: pv.clientY - startY };
      opts.onEnd?.(d);
      setTransform({ x: 0, y: 0 });
      controller.abort();
    };
    window.addEventListener("pointermove", move, { signal });
    window.addEventListener("pointerup", end, { signal });
    window.addEventListener("pointercancel", end, { signal });
  }

  return {
    /** Spread onto the drag-handle element to bind `pointerdown`. */
    dragActivators: { onPointerDown } as Record<string, (e: Event) => void>,
    /** Current drag offset signal (reset to 0 after pointerup). */
    transform,
  };
}
