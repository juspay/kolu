/** Chrome spacing tokens — shared density vocabulary for the canvas tile
 *  title bar and the right-panel tab bar.
 *
 *  Scope: **sizing/spacing only.** No color formulas (those live in
 *  `canvas/tileChrome.ts` for per-theme derivations or in Tailwind
 *  utilities for static surfaces). The volatility this module owns is
 *  "chrome density vocabulary" — the height, padding, and icon-button
 *  footprint that should scale together if the product targets denser
 *  or sparser displays. */

/** Icon-button sized for a chrome bar (title bar, tab bar). Square 28px
 *  hit area, lg radius. Used by canvas tile chrome (maximize, close) and
 *  right panel chrome (pin, collapse).
 *
 *  Color/hover/text sit with the caller because chrome surfaces vary:
 *  canvas tile bg is per-terminal theme (use `hover:bg-black/20`);
 *  right panel bg is the static dark surface (use `hover:bg-surface-0/50`
 *  for a translucent darken or a foreground-class change). */
export const CHROME_ICON_BUTTON_CLASS =
  "flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer";

/** Compact icon button for sub-chrome (sub-tab bars, dense toolbars).
 *  24px square — large enough for a tap target, small enough for a
 *  three-button pill row. Used by right panel sub-tabs. */
export const COMPACT_ICON_BUTTON_CLASS =
  "flex items-center justify-center w-6 h-6 rounded transition-colors cursor-pointer";
