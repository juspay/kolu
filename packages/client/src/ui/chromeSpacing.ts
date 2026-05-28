/** Chrome spacing tokens — shared density vocabulary for the canvas tile
 *  title bar, the right-panel tab bar, and the rail/sidebar widths shared
 *  by the dock and the right panel.
 *
 *  Scope: **sizing/spacing only.** No color formulas (those live in
 *  `canvas/tileChrome.ts` for per-theme derivations or in Tailwind
 *  utilities for static surfaces). The volatility this module owns is
 *  "chrome density vocabulary" — the height, padding, and icon-button
 *  footprint that should scale together if the product targets denser
 *  or sparser displays. */

/** Width of the collapsed dock rail AND the collapsed right-panel rail.
 *  The two surfaces share the value so the canvas grid reads with one
 *  consistent gutter on both sides — 44 px gives the 32 px chips ~6 px
 *  breathing room and the 26 px-wide header buttons fit comfortably
 *  stacked. Single source so neither side can drift independently when
 *  rail density changes. */
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

/** Cards-mode dock right-gutter — Tailwind class string applied to
 *  `RepoSection`'s grid container so the right-aligned columns (time
 *  label, "show all" footer link) sit a consistent distance from the
 *  card's rounded right edge. 12 px matches the section-header
 *  `pr-3` count inset, so every right-aligned element in the dock
 *  reads on the same vertical line. _The left side stays at 24 px
 *  (`pl-6`) because row content nests under an outdented section
 *  header at `pl-3` — the indent is hierarchical, not symmetric._
 *
 *  Paired with `DOCK_CARDS_GUTTER_NEG_CLASS`: any descendant that
 *  bleeds to the dock card's right edge (hover/active row backgrounds,
 *  section-header full-bleed band) cancels this padding with the
 *  negative-margin twin. Move them together. */
export const DOCK_CARDS_GUTTER_CLASS = "pr-3";

/** Negative-margin twin of `DOCK_CARDS_GUTTER_CLASS`. Applied to
 *  descendants of `RepoSection` whose background must extend through
 *  the parent's right padding to the dock card's right edge — row
 *  hover/active surfaces and the section-header band.
 *
 *  Subgrid caveat: a `grid-cols-subgrid` descendant recomputes its
 *  column tracks inside its own (now extended) border box, so the
 *  parent's `pr-6` no longer constrains the right column. Re-apply
 *  `DOCK_CARDS_GUTTER_CLASS` directly to such descendants to push the
 *  inner columns back into the section's content area. The right side
 *  has to stay at the call site because the desktop / mobile rows
 *  legitimately differ (24 px vs. 12 px); the left side does not —
 *  see `DOCK_CARDS_SUBGRID_LEFT_RESTORE`. */
export const DOCK_CARDS_GUTTER_NEG_CLASS = "-mr-3";

/** Layout-coupling token (not a density token like the rest of this
 *  file): cancel-and-restore the left dock gutter on a
 *  `grid-cols-subgrid` descendant of `RepoSection`. Both the cancel
 *  (`-ml-6`) and the restore (`pl-6`) have to ride on the same
 *  element, and the left value is identical between desktop and
 *  mobile rows, so the pair lives behind one symbol — applying just
 *  the cancel without the restore would land the subgrid's first
 *  column flush against the dock's left edge. The right-side cancel
 *  + restore stays at the call site because desktop uses
 *  `DOCK_CARDS_GUTTER_*` (24 px) while mobile uses `pr-3` / `-mr-3`
 *  (12 px); see the comment in `MobileDockDrawer.tsx`. */
export const DOCK_CARDS_SUBGRID_LEFT_RESTORE = "-ml-6 pl-6";
