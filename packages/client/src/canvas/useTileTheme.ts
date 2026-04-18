/** Tile theme accessor — singleton lookup that maps a terminal id to its
 *  `TileTheme` (`{ bg, fg }`), feeding every surface that mirrors the
 *  tile's chrome (CanvasTile, ChromeBar pill swatches, mobile sheet).
 *
 *  Wraps `useThemeManager`'s `getTerminalTheme` and adapts the xterm
 *  `ITheme` shape — which carries optional `background`/`foreground` —
 *  into the always-defined two-field `TileTheme` consumers expect.
 *  Centralising this fallback (`var(--color-surface-1)` /
 *  `var(--color-fg)`) means a theme-tweak flows through every surface
 *  without each component re-deriving the defaults. */

import type { TerminalId } from "kolu-common";
import { useThemeManager } from "../useThemeManager";
import type { TileTheme } from "./tileChrome";

export function useTileTheme(): (id: TerminalId) => TileTheme {
  const themeManager = useThemeManager();
  return (id) => {
    const t = themeManager.getTerminalTheme(id);
    return {
      bg: t.background ?? "var(--color-surface-1)",
      fg: t.foreground ?? "var(--color-fg)",
    };
  };
}
