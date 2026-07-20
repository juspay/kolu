/** Cards-mode dock width — the maximized dock's drag-to-resize footprint.
 *
 *  Its own leaf module (not folded into `Dock.tsx`) so the pure `clampDockCardsWidth`
 *  is unit-testable without evaluating the whole Dock component graph (`wire`, the
 *  surface stack, StatePip …), matching the dock folder's other tested leaves
 *  (`dockTree.ts`, `dockRowRanking.ts`, `pipVariant.ts`).
 *
 *  Persisted per-device like `dockMode` (a 13" laptop and a 27" desktop each keep
 *  their own dock width). Rail stays fixed at `RAIL_WIDTH_PX`; only cards mode is
 *  resizable. */

import { persistedPref } from "../../persistedPref";

/** Default cards width — the width the dock shipped with, and where a fresh
 *  install lands. Also the double-click-to-reset target. */
export const CARDS_WIDTH_PX = 288;

// Bounds for the user-resizable cards width. Floor keeps a row's
// `indicator · branch · pips · time` line legible; ceiling keeps the dock from
// swallowing the canvas it sits beside. The default sits inside the range.
const DOCK_CARDS_MIN_WIDTH_PX = 200;
const DOCK_CARDS_MAX_WIDTH_PX = 560;

/** Clamp a candidate cards width into the resize bounds. The drag setter and the
 *  stored-value parse both route through it, so a hand-edited `localStorage` value
 *  can't escape the range the drag handle enforces. */
export function clampDockCardsWidth(px: number): number {
  return Math.min(
    DOCK_CARDS_MAX_WIDTH_PX,
    Math.max(DOCK_CARDS_MIN_WIDTH_PX, px),
  );
}

/** Per-device cards-mode width in pixels. Stored through `clampDockCardsWidth`
 *  on read so a corrupt/out-of-range value degrades to the clamped default
 *  rather than a zero- or canvas-wide dock. */
const [dockCardsWidth, setDockCardsWidthRaw] = persistedPref<number>({
  name: "kolu-dock-cards-width",
  fallback: CARDS_WIDTH_PX,
  parse: (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`invalid dock width: ${raw}`);
    return clampDockCardsWidth(n);
  },
});

export { dockCardsWidth };

/** Set the cards width, clamped into bounds. The drag handle drives this on every
 *  pointer move; `persistedPref` writes each step to `localStorage` (cheap,
 *  per-device, no server round-trip). */
export function setDockCardsWidth(px: number): void {
  setDockCardsWidthRaw(clampDockCardsWidth(px));
}
