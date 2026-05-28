/** Z-index contract for the **canvas-tile / resize-handle stacking
 *  axis** — the volatility axis that caused the original outer-handle
 *  shadowing bug. Surrounding chrome surfaces (ChromeBar `z-50`, Dock
 *  `z-30`, CanvasMinimap `z-20`, MobileTileView overlays) keep their
 *  literal Tailwind classes at the call site and don't participate in
 *  this catalog's invariant. They share the same root stacking context
 *  as the canvas (`canvas-container` is `overflow-hidden relative`
 *  with no explicit z-index — no stacking context) but don't overlap
 *  the right-panel boundary in practice.
 *
 *  **Exception — maximized tile `z-40`:** A maximized tile uses
 *  `absolute inset-0 z-40` within `canvas-container`; its right edge
 *  coincides with the handle's left edge, so its bounding box covers
 *  the 4px strip where `::before` extends into the canvas area.
 *  `z-40 > Z_HANDLE_OUTER=20` means the outer handle's hit zone is
 *  shadowed during maximized mode. Pre-existing gap (handle had no
 *  z-index before this catalog). Fix: raise `Z_HANDLE_OUTER` above 40
 *  or add explicit `z-index` to `canvas-container` to contain tiles.
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
 *  enforces this invariant with a 25-point elementFromPoint sweep.
 *
 *  `Z_HANDLE_INNER` has no dedicated e2e coverage — it is a
 *  precautionary value that must stay above auto/zero (see its doc
 *  below); any future refactor to inner handles should add a test. */

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
