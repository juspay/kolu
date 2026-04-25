/** Terminal theme catalog + perceptual-distance picker.
 *
 *  Themes are parsed from iTerm2-Color-Schemes (Ghostty format) and ship
 *  checked-in as themes.json — no env var, no Vite virtual module.
 *
 *  To regenerate from iTerm2-Color-Schemes:
 *    just regenerate  (from this package directory)
 */

export type { ITheme } from "@xterm/xterm";
// Family pairs (light/dark siblings for OS-driven variant swap)
export {
  FAMILY_PAIRS,
  type FamilyPair,
  resolveThemeForVariant,
} from "./families.ts";
// Theme picker
export { hexToOkLab, okLabDistance, pickTheme } from "./picker.ts";
// Theme catalog
export {
  availableThemes,
  DEFAULT_THEME,
  DEFAULT_THEME_NAME,
  FONT_FAMILY,
  getThemeByName,
  type NamedTheme,
  resolveThemeBgs,
} from "./theme.ts";
