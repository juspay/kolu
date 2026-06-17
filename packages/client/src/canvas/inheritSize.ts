/** Inherit-size bridge — passes the active tile's dimensions to the canvas
 *  placement effect at terminal creation time.
 *
 *  Race: `handleCreate` calls `setActiveSilently(newId)` before the canvas
 *  `tileIds` effect fires, so by the time the effect reads `store.activeId()`
 *  it is already the new tile (which has no layout yet). The effect cannot
 *  read the previous active tile's size from the store. This module is the
 *  bridge: `handleCreate` writes the size before `setActiveSilently`; the
 *  canvas effect reads and clears it for the new tile's layout. */

import { createSignal } from "solid-js";

const [pendingSize, setPendingSize] = createSignal<{
  w: number;
  h: number;
} | null>(null);

/** Store the size to inherit for the next created tile. Called by
 *  `handleCreate` before the create RPC (the server push during the await
 *  triggers the canvas placement effect, which consumes the signal). */
export function setInheritSize(size: { w: number; h: number }) {
  setPendingSize(size);
}

/** Read and clear the pending inherit size. Called by the canvas placement
 *  effect when assigning a default layout to a new tile. Returns null if
 *  no size was pending (first terminal, or creation path that didn't set). */
export function consumeInheritSize(): { w: number; h: number } | null {
  const size = pendingSize();
  setPendingSize(null);
  return size;
}
