import { DEFAULT_THEME_NAME } from "terminal-themes";
import type { ThemeMode, ThemeSlots } from "kolu-common";

/** Return the exact stored value for a slot without applying fallback. */
export function storedThemeNameForMode(
  themeSlots: ThemeSlots,
  mode: ThemeMode,
): string | undefined {
  return mode === "light" ? themeSlots?.light : themeSlots?.dark;
}

/** Whether a preview for one slot is actually visible under the current mode. */
export function previewAppliesToMode(
  previewMode: ThemeMode | undefined,
  resolvedMode: ThemeMode,
): boolean {
  return previewMode !== undefined && previewMode === resolvedMode;
}

/** Resolve the theme name for the requested appearance, falling back to the
 *  other slot before the global default. */
export function effectiveThemeNameForMode(
  themeSlots: ThemeSlots,
  mode: ThemeMode,
): string {
  if (mode === "light") {
    return themeSlots?.light ?? themeSlots?.dark ?? DEFAULT_THEME_NAME;
  }
  return themeSlots?.dark ?? themeSlots?.light ?? DEFAULT_THEME_NAME;
}

/** Build theme slots for terminal creation.
 *
 *  - If explicit slots are provided (including a partial one), preserve them
 *    exactly — used by session restore.
 *  - Otherwise seed both slots from the chosen fallback theme so brand-new
 *    terminals keep one visual identity across light/dark until customized. */
export function seedThemeSlots(
  themeSlots: ThemeSlots,
  fallbackTheme: string | undefined,
): ThemeSlots {
  if (themeSlots) return themeSlots;
  if (!fallbackTheme) return undefined;
  return { light: fallbackTheme, dark: fallbackTheme };
}
