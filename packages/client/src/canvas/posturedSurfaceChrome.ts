/** Shared chrome classes for surfaces that mirror canvas posture
 *  (dock + right panel today). The two surfaces apply the same outer
 *  treatment — z-order, top inset, corner radius, shadow in tiled mode;
 *  flex sizing in maximized — and differ only on the side-mirrored
 *  parts (`left-4` vs `right-4`, `border-r` vs `border-l`) plus their
 *  own height policy (dock shrinks to its row list, panel claims the
 *  full column).
 *
 *  Lives here rather than inside `useViewPosture.ts` because that hook
 *  is deliberately scoped to state (`maximized`, `toggle`); class
 *  strings are a styling decision and don't belong in the seam that
 *  may absorb future PiP / per-tile-maximize variants. */

/** Tiled mode: floating rounded card over the canvas grid. Append a
 *  side anchor (`left-4` for dock, `right-4` for right panel) and any
 *  surface-specific height bound (`max-h-…` or `bottom-4`). */
export const POSTURED_TILED_FLOAT =
  "absolute z-30 top-20 rounded-2xl shadow-2xl shadow-black/40";

/** Maximized mode: flush flex sibling of the canvas with full canvas
 *  height. Append the appropriate edge separator (`border-r border-edge`
 *  for dock on the left, `border-l border-edge` for right panel). */
export const POSTURED_MAXIMIZED_FLUSH = "relative shrink-0 h-full";
