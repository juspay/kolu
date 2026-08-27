/** Chrome spacing tokens — shared density vocabulary for the canvas tile
 *  title bar, the right-panel tab bar, and the dock rail width.
 *
 *  Scope: **sizing/spacing only.** No color formulas (those live in
 *  `canvas/tileChrome.ts` for per-theme derivations or in Tailwind
 *  utilities for static surfaces). The volatility this module owns is
 *  "chrome density vocabulary" — the height, padding, and icon-button
 *  footprint that should scale together if the product targets denser
 *  or sparser displays.
 *
 *  The dock ROW's own geometry left with the row: the grid template, the
 *  gutters, the subgrid restore and the density table now live in
 *  `@kolu/solid-dockrow/rowValues`, beside the component that spends them, and
 *  `SLEEPING_RECEDE_CLASS` sits with the pip vocabulary it pairs with
 *  (`@kolu/solid-statepip/pipVariant`). Location is structure — what remains
 *  here is chrome that is not a row. */

/** Width of the collapsed dock rail. 44 px gives the 32 px chips ~6 px
 *  breathing room and the 26 px-wide header buttons fit comfortably
 *  stacked. Lives here (rather than in `canvas/dock/Dock.tsx`) so that
 *  if a second rail-style surface lands later it has a single source to
 *  reach for — but today the dock is the only consumer. */
export const RAIL_WIDTH_PX = 44;

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
