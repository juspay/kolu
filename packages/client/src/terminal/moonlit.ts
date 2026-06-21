/** The moonlit palette — the single source for the "sleeping/dormant" visual
 *  identity. A sleeping tile reads consistently "asleep" regardless of which
 *  per-terminal theme it carries, so these colors are FIXED (not theme-derived).
 *
 *  Lifted here so the one accent (`accent`) and its siblings are defined ONCE and
 *  read by the three sleeping surfaces — DormantTileBody (the frozen tile body),
 *  the minimap's sleeping tile branch, and the RowPips ☾ glyph — instead of
 *  drifting as raw hex literals across three files. */
export const MOONLIT = {
  /** DormantTileBody panel background. */
  bg: "#171a20",
  /** Minimap sleeping-tile fill. */
  tileBg: "#1d2230",
  /** Shared accent — ☾ glyph, dashed minimap border, Wake button, primary text. */
  accent: "#8895ad",
  /** Dimmed secondary text (slept-ago line, "PTY released"). */
  dim: "#5b626d",
  /** Ink on the accent-filled Wake button. */
  ink: "#0e1014",
  /** Wake button hover. */
  accentHover: "#a3afc4",
} as const;
