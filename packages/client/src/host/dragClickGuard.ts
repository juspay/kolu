/** dragClickGuard — swallow the ONE click a finished drag leaves behind.
 *
 *  A drag ends with `pointerup`, and the browser then fires `click` on whatever
 *  the gesture started on. For a sortable whose node FOLLOWS the pointer that is
 *  the same element `pointerdown` hit, so the click lands, and nothing in
 *  `@thisbeyond/solid-dnd@0.7.5` suppresses it (its `onPointerUp` only calls
 *  `dragEnd()`). On a host tab, whose whole body is two `<button>`s, that click
 *  switches host or toggles the diagnostics popover.
 *
 *  So: latch when a drag ENDS, and consume the latch from a capture-phase
 *  `click` listener on the chip — before either button's own handler runs.
 *  The latch clears on the next animation FRAME rather than a microtask: the
 *  click a real gesture produces lands in the same task run as `pointerup`
 *  (before any frame), while a drag that ends with no click at all — released
 *  off-element, cancelled — must not leave the latch armed for the next genuine
 *  click. (`dev/skills/kolu-client/SKILL.md` makes the same frame-not-microtask
 *  call for the controlled-component gesture token, for the same reason.)
 *
 *  A leaf: no DOM and no solid-dnd import, so `dragClickGuard.test.ts` can pin
 *  the whole contract off a plain boolean signal. */

import { type Accessor, createEffect, onCleanup } from "solid-js";

/** Arm the guard off `dragging` (a sortable's `isActiveDraggable`). The returned
 *  predicate answers "swallow this click?", CONSUMING the latch — so exactly one
 *  click per drag is swallowed and the next one gets through. */
export function createDragClickGuard(
  dragging: Accessor<boolean>,
): () => boolean {
  let armed = false;
  let frame: number | undefined;

  const disarm = (): void => {
    armed = false;
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
  };

  createEffect((wasDragging: boolean) => {
    const isDragging = dragging();
    if (wasDragging && !isDragging) {
      disarm();
      armed = true;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        armed = false;
      });
    }
    return isDragging;
  }, false);

  onCleanup(disarm);

  return () => {
    if (!armed) return false;
    disarm();
    return true;
  };
}
