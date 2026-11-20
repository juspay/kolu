import type { TerminalId } from "kolu-common/surface";
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
