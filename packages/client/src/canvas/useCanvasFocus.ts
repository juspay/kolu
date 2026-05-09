/** Canvas viewport focus reader — desktop only.
 *
 *  Exposes the `centerActiveRequest` impulse signal as `request` so the
 *  canvas can react when something elsewhere (most often `store.activate`,
 *  occasionally the cascade-placement effect inside TerminalCanvas
 *  itself) asks the viewport to follow a tile. There is no public writer
 *  here — system-driven activation goes through `store.activate(id)`,
 *  which is the single seam that owns both `setActiveId` and the
 *  centering bump. Click/focus paths use `store.setActiveSilently(id)`.
 *
 *  Mirrors `useViewPosture` for `canvasMaximized`: the canvas owns the
 *  reader-side surface; writers live on the store so terminal-side
 *  callers don't take a reverse dep on `canvas/`. */

import { useTerminalStore } from "../terminal/useTerminalStore";

export function useCanvasFocus() {
  const store = useTerminalStore();
  return {
    /** Latest "pan to this tile" intent payload, or null if none yet. */
    request: store.centerActiveRequest,
  } as const;
}
