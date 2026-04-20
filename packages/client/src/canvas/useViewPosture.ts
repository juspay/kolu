/** Canvas display posture — desktop only. The single public seam for
 *  `canvasMaximized`. Canvas readers (ChromeBar, TerminalCanvas, PillTree)
 *  import this hook instead of reaching into `useTerminalStore`, so a
 *  future enum upgrade (PiP, per-tile maximize) can be absorbed here
 *  without rippling across every reader.
 *
 *  Scope is deliberately narrow: only `maximized` (the state) and
 *  `toggle` (the single writer). Per-reader derivations like "show
 *  minimap" or "pill-tree opacity" stay at the reader — naming hook
 *  outputs after reader-specific behaviors would couple this interface
 *  to their internals.
 *
 *  Mobile is a separate axis (device class, media query) handled one
 *  level up in App.tsx (`MobileTileView` vs `TerminalCanvas`) and
 *  deliberately stays out of this hook — different change frequency,
 *  different reactivity source, different blast radius. Tracked: kolu#628. */

import { useTerminalStore } from "../terminal/useTerminalStore";

export function useViewPosture() {
  const store = useTerminalStore();
  return {
    /** True when the active tile is rendered fullscreen over the canvas. */
    maximized: store.canvasMaximized,
    /** Toggle between tiled canvas and maximized. Single writer. */
    toggle: store.toggleCanvasMaximized,
  } as const;
}
