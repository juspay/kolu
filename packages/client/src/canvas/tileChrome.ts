/** Shared tile-chrome derivations — single source for the color tiers
 *  CanvasTile, PillTree, and CanvasMinimap all derive from a terminal's
 *  theme. Same `color-mix(in oklch, fg X%, bg)` formula was duplicated
 *  across three files; consolidating it here means a tweak to one tier
 *  flows everywhere it's read.
 *
 *  Scope: **color derivations only**. Tile sizing, layout, border-radius,
 *  shadow, hover state, animation, and other interaction styling stay
 *  inline in their owning component (CanvasTile, PillTree, CanvasMinimap).
 *  This module's volatility is the per-theme color formula — anything
 *  that doesn't change when the formula changes belongs elsewhere. */

/** Minimal theme info — bg/fg from the terminal's color scheme. Both
 *  values are CSS color strings (any form `color-mix` accepts). */
export interface TileTheme {
  bg: string;
  fg: string;
}

/** Title-bar background — a faint fg-tinted bg. Used by CanvasTile's
 *  title bar AND by PillTree pills, so the pill visually echoes the
 *  tile's chrome (one color, two surfaces). */
export function tileTitleBarBg(theme: TileTheme): string {
  return `color-mix(in oklch, ${theme.fg} 8%, ${theme.bg})`;
}

/** Title-bar border / divider — slightly stronger fg mix than the bg
 *  so the seam reads but doesn't shout. */
export function tileTitleBarBorder(theme: TileTheme): string {
  return `color-mix(in oklch, ${theme.fg} 12%, ${theme.bg})`;
}

/** Foreground tier inside the title bar.
 *  - tier 1 = primary (theme.fg passthrough)
 *  - tier 2 = secondary (~text labels)
 *  - tier 3 = tertiary (~icon defaults, fg-3 var)
 *
 *  Mirrors the global `--color-fg-{2,3}` scheme but locally derived
 *  from the per-tile theme so contrast holds against any bg. */
export function tileFgTier(theme: TileTheme, level: 1 | 2 | 3): string {
  if (level === 1) return theme.fg;
  const pct = level === 2 ? 75 : 55;
  return `color-mix(in oklch, ${theme.fg} ${pct}%, ${theme.bg})`;
}

/** Mid-strength foreground used for chrome buttons (close, maximize)
 *  that need to read against the title-bar bg without dominating. */
export function tileChromeButton(theme: TileTheme): string {
  return `color-mix(in oklch, ${theme.fg} 50%, ${theme.bg})`;
}

/** Minimap tile border — a stronger fg mix so the rectangle reads
 *  against the dim minimap surface. */
export function tileMinimapBorder(theme: TileTheme): string {
  return `color-mix(in oklch, ${theme.fg} 25%, ${theme.bg})`;
}

/** Border-radius class shared by tiled canvas tiles and the floating
 *  overlay right panel — both surfaces participate in the "rounded =
 *  floating element" contract, so a tweak to one flows to the other. */
export const TILE_BORDER_RADIUS_CLASS = "rounded-xl";

/** Depth shadow shared by an active canvas tile and the overlay right
 *  panel. They render at the same visual layer ("the active surface
 *  the user is working on"), so a depth tweak should land on both. The
 *  active-tile variant additionally adds a 1px accent ring inline at
 *  the call site. */
export const FLOATING_SURFACE_SHADOW = "0 8px 32px rgba(0,0,0,0.4)";
