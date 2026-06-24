/** The moonlit palette — the single source for the "sleeping/dormant" visual
 *  identity. A sleeping tile reads consistently "asleep" regardless of which
 *  per-terminal theme it carries, so these colors are FIXED (not light/dark
 *  derived).
 *
 *  Lifted here so the accent and its siblings are defined ONCE and read by the
 *  two client-side sleeping surfaces — DormantTileBody (the frozen tile body) and
 *  the minimap's sleeping tile branch — instead of drifting as raw hex literals.
 *  The shared `StatePip` ☾ (in `@kolu/solid-statepip`) reads the SAME accent
 *  through the `--color-moonlit` token in `@kolu/theme`, which `accent` points at
 *  below — so the one sleeping accent has a single home (the token), fixed across
 *  light/dark (no `:root:not(.dark)` override). */
export const MOONLIT = {
  /** DormantTileBody panel background. */
  bg: "#171a20",
  /** Minimap sleeping-tile fill. */
  tileBg: "#1d2230",
  /** Shared accent — ☾ glyph, dashed minimap border, Wake button, primary text.
   *  References the `--color-moonlit` token (`@kolu/theme`) so the StatePip ☾ and
   *  these client surfaces resolve one value. */
  accent: "var(--color-moonlit)",
  /** Dimmed secondary text (slept-ago line, "PTY released"). */
  dim: "#5b626d",
  /** Ink on the accent-filled Wake button. */
  ink: "#0e1014",
  /** Wake button hover. */
  accentHover: "#a3afc4",
} as const;
