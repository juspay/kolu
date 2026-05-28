/** Z-index contract for the **canvas-tile / resize-handle stacking
 *  axis** — the volatility axis that caused the original outer-handle
 *  shadowing bug. Surrounding chrome surfaces (ChromeBar `z-50`, Dock
 *  `z-30`, CanvasMinimap `z-20`, maximized-tile `z-40`,
 *  MobileTileView overlays) sit on their own axes and keep their
 *  literal Tailwind classes at the call site — they don't participate
 *  in this catalog's invariant.
 *
 *  Numbers are consumed as inline `z-index` style values at each site
 *  (Tailwind v4's @theme doesn't register custom `z-*` utility scales).
 *
 *  **Invariant:** `Z_HANDLE_OUTER > Z_CANVAS_TILE_ACTIVE`.
 *  Without this gap, a canvas tile whose right edge reaches the
 *  right-panel boundary paints over the outer handle's 4px ::before
 *  hit zone (the half that sits inside the canvas area) — killing
 *  both the hover indicator and the pointer target along that strip.
 *  The `right-panel.feature` "hittable at its full width" scenario
 *  enforces this with a 25-point elementFromPoint sweep.
 *
 *  Bump any of these and re-run that scenario — the test is the
 *  contract's only structural enforcement; this file is its
 *  catalog. */

export const Z_CANVAS_TILE_ACTIVE = 10;
export const Z_CANVAS_TILE_INACTIVE = 1;

/** Inner vertical handle inside `CodeTab` (tree ↔ content split) and
 *  the terminal-split handle inside a canvas tile. Both live inside a
 *  positioned ancestor whose own stacking context insulates them from
 *  the canvas-tile z-axis; the explicit value is defense against
 *  positioned descendants inside that context (Pierre's tree rows,
 *  potential xterm overlays).
 *
 *  Numerically equal to `Z_CANVAS_TILE_ACTIVE` only by coincidence —
 *  the two values live in different stacking contexts and can move
 *  independently. The shared 10 reflects "the lowest explicit value
 *  that beats auto/zero," not a coupling.
 *
 *  **Within-tile ceiling:** any positioned descendant inside the
 *  canvas-tile stacking context (xterm overlays, search affordances,
 *  scroll-to-bottom buttons, …) that should remain *below* the inner
 *  handle's hit zone must stay below this value. */
export const Z_HANDLE_INNER = 10;

/** Outer horizontal handle between the canvas and the right panel.
 *  Must exceed `Z_CANVAS_TILE_ACTIVE` so an active tile butting the
 *  right-panel boundary doesn't shadow the handle's ::before. */
export const Z_HANDLE_OUTER = 20;
