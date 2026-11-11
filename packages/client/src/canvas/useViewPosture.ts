/** Canvas display posture — desktop only. The single public seam for
 *  `canvasMaximized`. Canvas readers (ChromeBar, TerminalCanvas, Dock,
 *  RightPanel) import this hook instead of reaching into
 *  `useTerminalStore`, so a future enum upgrade (PiP, per-tile maximize)
 *  can grow `layout()`'s discriminant without rippling across every reader.
 *
 *  Scope is deliberately narrow: two questions (`layout`, `posture`) and
 *  `toggle` (the single writer). Per-reader derivations like "show minimap"
 *  or "workspace-switcher opacity" stay at the reader — naming hook
 *  outputs after reader-specific behaviors would couple this interface
 *  to their internals.
 *
 *  Form factor is a separate axis (`layoutMode`, media queries) and the
 *  *posture state* (`layout`, `canMaximize`) stays canvas-focused: which view to
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
   *  source of truth for this sub-fact, shared by `layout()`'s guard below and
   *  exposed to readers (ChromeBar) via `canMaximize`. Keyed off the TILE
   *  count, so a future sleeping-only workspace stays maximizable. */
  const canMaximize = (): boolean => tileStore.tileCount() > 0;
  /** Land on one of the two postures — THE single posture writer, and the one
   *  place that knows the orchestrator sits beside them.
   *
   *  Leaving the orchestrator FIRST is what makes the write visible. The two
   *  segments describe a HOST TAB's canvas, so pressing either while the
   *  conversation is on screen is a request for that canvas — and a write
   *  whose result stayed hidden behind the chat would be a control that lied
   *  about where it lands.
   *
   *  It happens before the write guard below, not inside it, and that ordering
   *  is the behaviour: `⌘⇧M` on a phone must still leave the conversation. The
   *  guard refuses to move a posture that has no canvas to show it and no tile
   *  to maximize — neither of which is true of the chat, which is mounted on
   *  every form factor (a sheet on touch) and is the thing on screen. A guard
   *  that ran first made the chord dead on exactly the device with no `Esc` key.
   *
   *  The write guard: a no-op without a spatial canvas (any non-desktop layout
   *  — phone or compact — where the canvas isn't mounted) or with zero
   *  terminals (the same `canMaximize` predicate `layout()` reads and the
   *  affordances gate on). Gating here — not in each caller — keeps a
   *  non-desktop hardware-keyboard press from silently flipping the persisted
   *  per-host posture signal with no visible effect: the safety lives in the
   *  receptacle. */
  const postureTo = (maximized: boolean): void => {
    if (orchestratorMode()) exitOrchestratorMode();
    if (!supportsSpatialCanvas()) return;
    if (canMaximize() && store.canvasMaximized() !== maximized) {
      store.toggleCanvasMaximized();
    }
  };
  return {
    /** How the chrome LAYS OUT, which is also WHICH POSTURE THE USER CHOSE —
     *  the two were one question again the moment the orchestrator stopped
     *  borrowing the maximized layout. `"maximized"` is one flush tile with
     *  the dock and the right panel as real sidebars; `"tiled"` is the
     *  freeform canvas with both floating over it.
     *
     *  One thing folds in here that the persisted bit knows nothing about:
     *  with zero tiles the layout is always `"tiled"` (see `canMaximize`) — a
     *  derivation, not a mutation, so the persisted per-host bit re-applies
     *  the moment a terminal returns, and the empty-canvas Dock (mounted by
     *  App.tsx, see `Dock.tsx`) stays in its only reachable layout instead of
     *  taking the flush-sidebar classes inside a non-flex host and pushing the
     *  welcome card off-screen. The ORCHESTRATOR folds in NOTHING: it is a
     *  destination beside the host tabs rather than a posture of one, so the
     *  canvas under the chat stays in the layout its host was left in. */
    layout: (): ViewPostureMode =>
      store.canvasMaximized() && canMaximize() ? "maximized" : "tiled",
    /** Whether maximize is meaningful — a tile exists to maximize.
     *  Readers gate the maximize affordance on this so it never disagrees
     *  with `layout()`'s own guard. */
    canMaximize,
    postureTo,
    /** Flip the posture — `⌘⇧M` and the palette entry. It writes through
     *  `postureTo`, so a press made while the conversation is on screen leaves
     *  it and lands on the canvas it just asked for. */
    toggle: (): void => postureTo(!store.canvasMaximized()),
  } as const;
}
