/** Active-terminal accent — single CSS color string the right panel uses
 *  to subtly mirror the active terminal's identity (active-tab underline,
 *  pinned-pin tint).
 *
 *  Scope: **one accent token, panel-side.** Deliberately narrower than
 *  `canvas/tileChrome.ts`'s per-theme color formula. The canvas needs
 *  fg/bg/title-bar tiers so chrome stays readable against the tile bg;
 *  the panel only needs one accent against its own static dark surface.
 *  Keeping the seam thin means we can swap the source later (workspace
 *  theme, user-configured accent, generic `--color-accent`) without
 *  touching tile chrome.
 *
 *  Falls back to `--color-accent` when no terminal is active. When a
 *  terminal is active but its theme omits foreground or background,
 *  coalesces those to the same defaults `useTileTheme` uses so the
 *  panel accent renders through the same formula path as the canvas
 *  chrome. */

import { createMemo, type Accessor } from "solid-js";
import { useThemeManager } from "../useThemeManager";
import { useTerminalStore } from "../terminal/useTerminalStore";

export function useActiveTerminalAccent(): Accessor<string> {
  const themeManager = useThemeManager();
  const store = useTerminalStore();
  return createMemo(() => {
    if (store.activeId() === null) return "var(--color-accent)";
    // Coalesce missing fg/bg to the same defaults `useTileTheme` uses so
    // a partial theme renders the panel accent through the same formula
    // path as the canvas chrome — never silently drops to a hard-coded
    // accent color that would diverge from the tile's appearance.
    const theme = themeManager.activeTheme();
    const fg = theme.foreground ?? "var(--color-fg)";
    const bg = theme.background ?? "var(--color-surface-1)";
    // 70% fg + 30% bg = readable accent against any panel surface
    // without becoming the foreground itself.
    return `color-mix(in oklch, ${fg} 70%, ${bg})`;
  });
}
