/** The moonlit palette — the single source for the "sleeping/dormant" visual
 *  identity. A sleeping tile reads consistently "asleep" regardless of which
 *  per-terminal theme it carries, so these colors are FIXED (not light/dark
 *  derived).
 *
 *  Lifted here so the accent and its siblings are defined ONCE and read by the
 *  two client-side sleeping surfaces — DormantTileBody (the frozen tile body) and
 *  the minimap's sleeping tile branch — instead of drifting as raw hex literals.
 *  `MOONLIT` is fully self-contained: every colour is a literal here, including
 *  `accent` (`#8895ad`). The shared `StatePip` ☾ (in `@kolu/solid-statepip`)
 *  resolves its own accent from the `--color-moonlit` token in `@kolu/theme`,
 *  which carries the SAME value (`#8895ad`) — so the pip and these client tiles
 *  each read from their own home, both fixed across light/dark (no
 *  `:root:not(.dark)` override). The two literals are pinned equal by
 *  `moonlit.test.ts` so the cross-file value can't drift silently — kept
 *  separate (not folded onto the token) because the other five MOONLIT colours
 *  have no theme token and the dormant tile + minimap need the raw value to
 *  string-interpolate a `border:` / `background:`. */
export const MOONLIT = {
  /** DormantTileBody panel background. */
  bg: "#171a20",
  /** Minimap sleeping-tile fill. */
  tileBg: "#1d2230",
  /** Shared accent — ☾ glyph, dashed minimap border, Wake button, primary text.
   *  Matches the `--color-moonlit` token (`@kolu/theme`) the StatePip ☾ reads, so
   *  the two sleeping surfaces stay in tonal agreement. */
  accent: "#8895ad",
  /** Dimmed secondary text (slept-ago line, "PTY released"). */
  dim: "#5b626d",
  /** Ink on the accent-filled Wake button. */
  ink: "#0e1014",
  /** Wake button hover. */
  accentHover: "#a3afc4",
} as const;
