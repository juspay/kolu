/** Resolve a drop where the pointer was released.
 *
 *  dnd-kit's `PointerSensor` applies pointer moves once per animation frame,
 *  and its `pointerup` ends the drag without applying the move still pending.
 *  This plugin listens for `pointerup` in the capture phase on the document —
 *  added when the scope mounts, so it runs before the listener the sensor adds
 *  per press — and moves the operation to the release point first. */

import { Plugin } from "@dnd-kit/abstract";
import type { DragDropManager } from "@dnd-kit/dom";

export class ReleasePoint extends Plugin<DragDropManager> {
  constructor(manager: DragDropManager) {
    super(manager);
    const release = (up: PointerEvent): void => {
      const { dragOperation } = manager;
      const press = dragOperation.activatorEvent;
      if (!dragOperation.status.dragging) return;
      if (press instanceof PointerEvent && press.pointerId !== up.pointerId)
        return;
      dragOperation.position.current = { x: up.clientX, y: up.clientY };
    };
    document.addEventListener("pointerup", release, { capture: true });
    const destroy = this.destroy.bind(this);
    this.destroy = () => {
      document.removeEventListener("pointerup", release, { capture: true });
      destroy();
    };
  }
}
