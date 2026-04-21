/** Active-terminal accent — single CSS color string the right panel uses
 *  to subtly mirror the active terminal's identity (active-tab underline).
 *
 *  Pure CSS: reads the `--active-terminal-{fg,bg}` vars App.tsx publishes
 *  from `useThemeManager().activeTheme()` (App.tsx:475-479), so no JS
 *  subscription, no `createMemo`, no double-derivation against a separate
 *  active-id signal.
 *
 *  Scope: **one accent token, panel-side.** Deliberately narrower than
 *  `canvas/tileChrome.ts`'s per-theme color formula. The canvas needs
 *  fg/bg/title-bar tiers so chrome stays readable against the tile bg;
 *  the panel only needs one accent against its own static dark surface.
 *  Keeping the seam thin means we can swap the formula later (workspace
 *  theme, user-configured accent, generic `--color-accent`) without
 *  touching tile chrome. */

/** 70% fg + 30% bg = readable accent against any panel surface without
 *  becoming the foreground itself. */
export const ACTIVE_TERMINAL_ACCENT =
  "color-mix(in oklch, var(--active-terminal-fg) 70%, var(--active-terminal-bg))";
