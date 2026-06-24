/** Chrome spacing tokens — shared density vocabulary for the canvas tile
 *  title bar, the right-panel tab bar, and the dock rail width.
 *
 *  Scope: **sizing/spacing only.** No color formulas (those live in
 *  `canvas/tileChrome.ts` for per-theme derivations or in Tailwind
 *  utilities for static surfaces). The volatility this module owns is
 *  "chrome density vocabulary" — the height, padding, and icon-button
 *  footprint that should scale together if the product targets denser
 *  or sparser displays. */

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

/** Cards-mode dock right-gutter — Tailwind class string applied to
 *  `RepoSection`'s grid container so the right-aligned columns (time
 *  label, "show all" footer link) sit a consistent distance from the
 *  card's rounded right edge. 12 px matches the section-header
 *  `pr-3` count inset, so every right-aligned element in the dock
 *  reads on the same vertical line. _The left side sits at 12 px
 *  (`pl-3`), the SAME inset as the section header text, so the row's
 *  leading indicator aligns with the repo name (R-activity-merge; the
 *  repo spine + tinted header band carry the grouping, no indent needed)._
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
 *  (`-ml-3`) and the restore (`pl-3`) have to ride on the same
 *  element, and the left value is identical between desktop and
 *  mobile rows, so the pair lives behind one symbol — applying just
 *  the cancel without the restore would land the subgrid's first
 *  column flush against the dock's left edge. The cancel MUST match
 *  the section's own `pl-3` so the full-bleed row background lands on
 *  the section's content edge. Row content sits at `pl-3` (12 px) —
 *  the SAME inset as the section header text, so the leading indicator
 *  aligns with the repo name rather than indenting past it
 *  (R-activity-merge reclaimed the old 24 px `pl-6` waste; the repo
 *  spine + tinted header band carry the grouping the indent used to).
 *  The right-side cancel + restore stays at the call site because
 *  desktop uses `DOCK_CARDS_GUTTER_*` (24 px) while the touch list uses
 *  `pr-3` / `-mr-3` (12 px); see the comment in `DockList.tsx`. */
export const DOCK_CARDS_SUBGRID_LEFT_RESTORE = "-ml-3 pl-3";

/** Dock row column geometry — single invariant shared by the desktop
 *  dock (`Dock.tsx`) and the touch dock (`DockList.tsx`). The row is one
 *  concept: `[indicator 18px][branch minmax(0,1fr)][sub-count auto][time
 *  auto]`, with the line-2 flex row (PR pip + subline) starting at the
 *  branch column. The line-2 start is derived, not free: branch =
 *  (pre-branch track count) + 1 = (indicator = 1) + 1 = col-start-2.
 *  Insert or remove a track and you MUST update the track list and
 *  `DOCK_ROW_BRANCH_COL` together, here, so the two stay in agreement.
 *
 *  R-activity-merge collapsed the old leading pair — a 12 px live-activity
 *  track + a 16/20 px state-pip track — into ONE 18 px column holding the
 *  merged `StatePip` (its green live RING replacing the standalone dot), so
 *  the row's dead left margin is reclaimed and desktop/touch no longer differ
 *  in this geometry. 18 px fits the indicator's circle (its halo bleeds into
 *  the surrounding gutter/gap, which don't clip). */
export const DOCK_ROW_GRID_DESKTOP = "grid-cols-[18px_minmax(0,1fr)_auto_auto]";
export const DOCK_ROW_GRID_TOUCH = "grid-cols-[18px_minmax(0,1fr)_auto_auto]";
export const DOCK_ROW_BRANCH_COL = "col-start-2";
