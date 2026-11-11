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
 *  can't silently flip the persisted per-host posture signal (see its doc
 *  below). Tracked: kolu#628. */

import { supportsSpatialCanvas } from "../capabilities";
import {
  exitOrchestratorMode,
  orchestratorMode,
} from "../orchestrator/useOrchestratorMode";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { useTileStore } from "../tile/useTileStore";

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
  const tileStore = useTileStore();
  /** "Maximize is meaningful" — there is a tile to maximize. With zero tiles
   *  the canvas is the empty/restore screen, which has no tile. The single
   *  source of truth for this sub-fact, shared by `mode()`'s guard below and
   *  exposed to readers (ChromeBar) via `canMaximize`. Keyed off the TILE
   *  count, so a future sleeping-only workspace stays maximizable. */
  const canMaximize = (): boolean => tileStore.tileCount() > 0;
  /** Land on one of the two postures — THE single posture writer, and the one
   *  place that knows the orchestrator is laid over them.
   *
   *  Leaving the orchestrator FIRST is what makes the write visible. The mode
   *  reads as `maximized` while it is on, so a write that only touched the bit
   *  underneath changed a posture nobody could see — and silently moved where
   *  `Esc` would land you later. Exiting happens whether or not the bit then
   *  moves, because with zero tiles there is no posture to flip but there is
   *  still a conversation to leave.
   *
   *  The write guard: a no-op without a spatial canvas (any non-desktop layout
   *  — phone or compact — where the canvas isn't mounted) or with zero
   *  terminals (the same `canMaximize` predicate `mode()` reads and the
   *  affordances gate on). Gating here — not in each caller — keeps a
   *  non-desktop hardware-keyboard press from silently flipping the persisted
   *  per-host posture signal with no visible effect: the safety lives in the
   *  receptacle. */
  const postureTo = (maximized: boolean): void => {
    if (!supportsSpatialCanvas()) return;
    if (orchestratorMode()) exitOrchestratorMode();
    if (canMaximize() && store.canvasMaximized() !== maximized) {
      store.toggleCanvasMaximized();
    }
  };
  return {
    /** Current canvas-display mode. `"maximized"` requires a tile to
     *  maximize (see `canMaximize`): with zero terminals the posture is
     *  always `"tiled"` regardless of the persisted per-host posture
     *  signal. This is a derivation, not a mutation — the per-host posture
     *  signal is left intact so it re-applies the moment a terminal
     *  returns. It also keeps the empty-canvas Dock (mounted by App.tsx,
     *  see `Dock.tsx`) in its only reachable posture, instead of taking
     *  the maximized flush-sidebar classes inside a non-flex host and
     *  pushing the welcome card off-screen.
     *
     *  ORCHESTRATOR MODE READS AS MAXIMIZED, and that is this seam earning
     *  its keep rather than a special case: the peek pane shows exactly one
     *  tile, flush, with the dock as a real left sidebar — which is the
     *  maximized posture under another name. Deriving it here means the
     *  canvas, the dock and the minimap each get it without a second axis to
     *  consult, and the per-host posture bit underneath is untouched, so
     *  leaving the mode lands on whichever posture the user actually chose.
     *  A WRITE still goes to that bit alone (`toggle` below), which is why
     *  the two call sites that must flip it read `canvasMaximized()` raw. */
    mode: (): ViewPostureMode =>
      (store.canvasMaximized() || orchestratorMode()) && canMaximize()
        ? "maximized"
        : "tiled",
    /** Whether maximize is meaningful — a tile exists to maximize.
     *  Readers gate the maximize affordance on this so it never disagrees
     *  with `mode()`'s own guard. */
    canMaximize,
    /** The posture BIT alone — what the persisted per-host signal says, with the
     *  orchestrator's borrowing of `mode()` left out. Two kinds of reader need
     *  it and both are about the write, not the view: a LABEL that promises
     *  where a press lands ("Maximize terminal" / "Restore canvas"), and a
     *  writer deciding whether there is anything to flip. Reading `mode()` for
     *  either is how the palette came to offer "Restore canvas" for a posture
     *  the user was not in. */
    rawMode: (): ViewPostureMode =>
      store.canvasMaximized() && canMaximize() ? "maximized" : "tiled",
    postureTo,
    /** Flip the posture — `⌘⇧M` and the palette entry. It flips the RAW bit,
     *  never `mode()`: in orchestrator mode `mode()` already answers
     *  "maximized", so toggling off it would leave the bit where it was and the
     *  chord would do nothing anybody could see. */
    toggle: (): void => postureTo(!store.canvasMaximized()),
  } as const;
}
