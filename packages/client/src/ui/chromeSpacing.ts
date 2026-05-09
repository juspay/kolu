/** Chrome spacing tokens — shared density vocabulary for canvas tile
 *  title bars and companion tile title bars.
 *
 *  Scope: **sizing/spacing only.** No color formulas (those live in
 *  `canvas/tileChrome.ts` for per-theme derivations or in Tailwind
 *  utilities for static surfaces). The volatility this module owns is
 *  "chrome density vocabulary" — the height, padding, and icon-button
 *  footprint that should scale together if the product targets denser
 *  or sparser displays. */

/** Icon-button sized for a chrome bar (canvas tile title bar, companion
 *  tile title bar). Square 28px hit area, lg radius. Used by canvas
 *  tile chrome (maximize, close) and companion tile chrome (close).
 *
 *  Color/hover/text sit with the caller because chrome surfaces vary:
 *  canvas/companion tile bg is per-terminal theme (use `hover:bg-black/20`).
 */
export const CHROME_ICON_BUTTON_CLASS =
  "flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer";

/** Compact icon button for sub-chrome (dense toolbars). 24px square —
 *  large enough for a tap target, small enough for a three-button pill
 *  row. */
export const COMPACT_ICON_BUTTON_CLASS =
  "flex items-center justify-center w-6 h-6 rounded transition-colors cursor-pointer";
