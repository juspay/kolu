/** Canvas display posture — desktop only. The single public seam for
 *  `canvasMaximized`. Canvas readers (ChromeBar, TerminalCanvas, Dock,
 *  RightPanel) import this hook instead of reaching into
 *  `useTerminalStore`, so a future enum upgrade (PiP, per-tile maximize)
 *  can grow `mode()`'s discriminant without rippling across every reader.
 *
 *  Scope is deliberately narrow: only `mode` (the state) and `toggle`
 *  (the single writer). Per-reader derivations like "show minimap" or
 *  "workspace-switcher opacity" stay at the reader — naming hook
 *  outputs after reader-specific behaviors would couple this interface
 *  to their internals.
 *
 *  Mobile is a separate axis (device class, media query) handled one
 *  level up in App.tsx (`MobileTileView` vs `TerminalCanvas`) and
 *  deliberately stays out of this hook — different change frequency,
 *  different reactivity source, different blast radius. Tracked: kolu#628. */

import { useTerminalStore } from "../terminal/useTerminalStore";

/** Canvas-display mode. `"tiled"` is the freeform canvas where the dock
 *  and right panel float as rounded cards over the grid; `"maximized"`
 *  is the single-tile fullscreen mode where both dock and right panel
 *  collapse into flush sidebars. A future PiP or per-tile maximize
 *  variant adds a new arm of this union — the hook's API does not
 *  change shape, only the discriminant values grow. */
export type ViewPostureMode = "tiled" | "maximized";

export function useViewPosture() {
  const store = useTerminalStore();
  return {
    /** Current canvas-display mode. `"maximized"` requires a tile to
     *  maximize: with zero terminals the canvas is the empty/restore
     *  screen, which has no tile, so the posture is always `"tiled"`
     *  there regardless of the persisted `kolu-canvas-maximized` flag.
     *  This is a derivation, not a mutation — the persisted preference
     *  is left intact so it re-applies the moment a terminal returns.
     *  It also keeps the empty-canvas Dock (mounted by App.tsx, see
     *  `Dock.tsx`) in its only reachable posture, instead of taking the
     *  maximized flush-sidebar classes inside a non-flex host and
     *  pushing the welcome card off-screen. */
    mode: (): ViewPostureMode =>
      store.canvasMaximized() && store.terminalIds().length > 0
        ? "maximized"
        : "tiled",
    /** Toggle between tiled canvas and maximized. Single writer. */
    toggle: store.toggleCanvasMaximized,
  } as const;
}
