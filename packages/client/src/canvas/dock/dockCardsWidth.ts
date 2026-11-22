/** Cards-mode dock width — the maximized dock's drag-to-resize footprint, on the
 *  shared sidebar width (`ui/resizableWidth.ts`), with the dock's own stored key
 *  and bounds.
 *
 *  Persisted per-device like `dockMode` (a 13" laptop and a 27" desktop each keep
 *  their own dock width). Rail stays fixed at `RAIL_WIDTH_PX`; only cards mode is
 *  resizable. */

import { resizableWidth } from "../../ui/resizableWidth";

export const DOCK_CARDS_WIDTH = resizableWidth("kolu-dock-cards-width", {
  // The width the dock shipped with.
  defaultPx: 288,
  // A row's `indicator · branch · pips · time` line stays legible.
  minPx: 200,
  // The dock does not swallow the canvas it sits beside.
  maxPx: 560,
  // Canvas kept beside the maximized dock: it is a `shrink-0` flex sibling of
  // the canvas inside a host the right-panel split can shrink well below
  // 560px (a 25% right panel on a narrow desktop leaves the canvas ~480px).
  reservePx: 320,
});
