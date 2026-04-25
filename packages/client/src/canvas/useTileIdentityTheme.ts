/** Tile identity-theme accessor — the stable swatch that surfaces tied
 *  to terminal identity (pill tree, minimap tile color) read so they
 *  don't flicker when the OS scheme flips and the rendered terminal
 *  variant follows. The render-side counterpart for tile chrome that
 *  wraps the live terminal contents is `useTileTheme`. */

import type { TerminalId } from "kolu-common";
import { useThemeManager } from "../useThemeManager";
import type { TileTheme } from "./tileChrome";

export function useTileIdentityTheme(): (id: TerminalId) => TileTheme {
  const themeManager = useThemeManager();
  return (id) => {
    const t = themeManager.getTerminalIdentityTheme(id);
    return {
      bg: t.background ?? "var(--color-surface-1)",
      fg: t.foreground ?? "var(--color-fg)",
    };
  };
}
