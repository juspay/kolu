/** Canvas viewport focus — desktop only. The single public seam for
 *  `centerActiveRequest`. Canvas readers (TerminalCanvas) import this hook
 *  instead of reaching into `useTerminalStore`, so a future upgrade
 *  (e.g. distinguishing "pan only" from "pan + zoom-to-fit") can be
 *  absorbed here without rippling across every reader.
 *
 *  Mirrors the pattern of `useViewPosture` for `canvasMaximized`: backing
 *  signal lives in `useViewState` (so terminal-side writers can bump it
 *  via `store.requestCenterActive(id)` the same way they call
 *  `store.toggleCanvasMaximized()`), but the canvas-side surface lives
 *  in this module. */

import { useTerminalStore } from "../terminal/useTerminalStore";

export function useCanvasFocus() {
  const store = useTerminalStore();
  return {
    /** Latest "pan to this tile" intent payload, or null if none yet.
     *  Each call to `request` allocates a fresh wrapper so reference
     *  inequality fires the listener even on back-to-back requests for
     *  the same id. */
    request: store.centerActiveRequest,
    /** Ask the canvas to pan so the given tile is centered. Used by
     *  system-driven flows (close → auto-switch, cascade-place new
     *  tile); user-driven activation (clicks, workspace switcher) calls
     *  `viewport.centerOnTile` directly instead. */
    requestCenter: store.requestCenterActive,
  } as const;
}
