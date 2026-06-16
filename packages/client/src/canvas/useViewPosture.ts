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
 *  Form factor is a separate axis (`layoutMode`, media queries) and the
 *  *posture state* (`mode`, `canMaximize`) stays canvas-focused: which view to
 *  mount — the touch panes (`MobileTileView` / `CompactTileView`) vs the canvas
 *  (`TerminalCanvas`) — is decided one level up in App.tsx — different change
 *  frequency, different reactivity source, different blast radius. The one
 *  exception is `toggle()`, which guards on `supportsSpatialCanvas()`
 *  (desktop-only) so a non-desktop (phone or compact) hardware-keyboard press
 *  can't silently flip the persisted flag (see its doc below). Tracked:
 *  kolu#628. */

import { supportsSpatialCanvas } from "../capabilities";
import { useTerminalStore } from "../terminal/useTerminalStore";

/** Canvas-display mode. `"tiled"` is the freeform canvas where the dock
 *  and right panel float as rounded cards over the grid; `"maximized"`
 *  is the single-tile fullscreen mode where both dock and right panel
 *  collapse into flush sidebars. A future PiP or per-tile maximize
 *  variant adds a new arm of this union — the hook's API does not
 *  change shape, only the discriminant values grow. */
export type ViewPostureMode = "tiled" | "maximized";

/** Human-readable name of the posture-toggle affordance, reflecting the
 *  action a select/click performs from the current posture: "Restore canvas"
 *  when already maximized, "Maximize terminal" when tiled. The single home
 *  for this label — read by ChromeBar's tooltip/aria-label, the command
 *  palette entry, and the tips registry — so the wording lives once and a
 *  future posture arm updates exactly one site. */
export const posturedActionLabel = (mode: ViewPostureMode): string =>
  mode === "maximized" ? "Restore canvas" : "Maximize terminal";

export function useViewPosture() {
  const store = useTerminalStore();
  /** "Maximize is meaningful" — there is a tile to maximize. With zero
   *  terminals the canvas is the empty/restore screen, which has no tile.
   *  The single source of truth for this sub-fact, shared by `mode()`'s
   *  guard below and exposed to readers (ChromeBar) via `canMaximize`. */
  const canMaximize = (): boolean => store.terminalIds().length > 0;
  return {
    /** Current canvas-display mode. `"maximized"` requires a tile to
     *  maximize (see `canMaximize`): with zero terminals the posture is
     *  always `"tiled"` regardless of the persisted `kolu-canvas-maximized`
     *  flag. This is a derivation, not a mutation — the persisted
     *  preference is left intact so it re-applies the moment a terminal
     *  returns. It also keeps the empty-canvas Dock (mounted by App.tsx,
     *  see `Dock.tsx`) in its only reachable posture, instead of taking
     *  the maximized flush-sidebar classes inside a non-flex host and
     *  pushing the welcome card off-screen. */
    mode: (): ViewPostureMode =>
      store.canvasMaximized() && canMaximize() ? "maximized" : "tiled",
    /** Whether maximize is meaningful — a tile exists to maximize.
     *  Readers gate the maximize affordance on this so it never disagrees
     *  with `mode()`'s own guard. */
    canMaximize,
    /** Toggle between tiled canvas and maximized. Single writer, and the
     *  write guard: a no-op without a spatial canvas (any non-desktop layout —
     *  phone or compact — where the canvas isn't mounted) or with zero
     *  terminals (same `canMaximize` predicate as `mode()`'s read guard and the
     *  affordance guard). Gating both surfaces here — not just the keyboard
     *  caller — keeps a non-desktop hardware-keyboard press from silently
     *  flipping the persisted `kolu-canvas-maximized` flag with no visible
     *  effect: the safety lives in the receptacle, not in each caller. */
    toggle: (): void => {
      if (supportsSpatialCanvas() && canMaximize()) {
        store.toggleCanvasMaximized();
      }
    },
  } as const;
}
